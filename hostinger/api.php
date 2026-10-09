<?php
declare(strict_types=1);

const FREQS = ['weekly', 'biweekly', 'biweeklyThu', 'semimonthly', 'monthly'];

function dbPath(): string {
    $fromEnv = getenv('PAYDAY_DB');
    if (is_string($fromEnv) && $fromEnv !== '') return $fromEnv;
    $outside = '/home/u878473359/domains/tanmoybarua.com/payday-data/payday.sqlite';
    $dir = dirname($outside);
    if ((is_dir($dir) || @mkdir($dir, 0755, true)) && is_writable($dir)) return $outside;
    $fallback = __DIR__ . '/data/payday.sqlite';
    if (!is_dir(dirname($fallback))) mkdir(dirname($fallback), 0755, true);
    return $fallback;
}

function openDb(): PDO {
    $file = dbPath();
    if (!is_dir(dirname($file))) mkdir(dirname($file), 0755, true);
    $db = new PDO('sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          freq TEXT NOT NULL,
          anchor TEXT NOT NULL,
          week_end TEXT NOT NULL DEFAULT \'sun\',
          lag INTEGER NOT NULL DEFAULT 0,
          rate REAL,
          color INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          day TEXT NOT NULL,
          job_id TEXT NOT NULL,
          hours REAL NOT NULL,
          amount REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS entries_day ON entries(day);
        CREATE TABLE IF NOT EXISTS debts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          total REAL NOT NULL,
          note TEXT NOT NULL DEFAULT \'\',
          opened TEXT NOT NULL,
          payment REAL,
          every_days INTEGER NOT NULL DEFAULT 14,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS debt_payments (
          id TEXT PRIMARY KEY,
          debt_id TEXT NOT NULL,
          day TEXT NOT NULL,
          amount REAL NOT NULL,
          note TEXT NOT NULL DEFAULT \'\'
        );
        CREATE INDEX IF NOT EXISTS debt_payments_debt ON debt_payments(debt_id);
    ');
    migrateCompany($db);
    ensureDebtColumns($db);
    ensureAuthTables($db);
    return $db;
}

const AUTH_COOKIE = 'payday_session';
const AUTH_PBKDF2_ROUNDS = 120000;
const AUTH_OTP_TTL_MS = 10 * 60 * 1000;
const AUTH_OTP_RESEND_MS = 60 * 1000;
const AUTH_OTP_MAX_ATTEMPTS = 5;

function sessionIdleMs(): int {
    $raw = getenv('PAYDAY_SESSION_IDLE_MS');
    if (is_string($raw) && is_numeric($raw) && (float)$raw > 0) return (int)$raw;
    return 60 * 60 * 1000;
}

function ensureAuthTables(PDO $db): void {
    $db->exec('
        CREATE TABLE IF NOT EXISTS app_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          pin_hash TEXT,
          cred_id TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          expires REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS otp_codes (
          email TEXT PRIMARY KEY,
          code_hash TEXT NOT NULL,
          expires REAL NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          sent_at REAL NOT NULL
        );
    ');
    $row = $db->query('SELECT id FROM app_lock WHERE id = 1')->fetch();
    if (!$row) $db->exec('INSERT INTO app_lock (id, enabled) VALUES (1, 0)');
}

function mailConfig(): array {
    $candidates = [];
    $fromEnv = getenv('PAYDAY_MAIL_CONFIG');
    if (is_string($fromEnv) && $fromEnv !== '') $candidates[] = $fromEnv;
    $candidates[] = dirname(dbPath()) . '/mail.json';
    $candidates[] = __DIR__ . '/data/mail.json';
    $fileCfg = [];
    foreach ($candidates as $file) {
        if (!is_string($file) || $file === '' || !is_file($file)) continue;
        $parsed = json_decode((string)file_get_contents($file), true);
        if (is_array($parsed)) { $fileCfg = $parsed; break; }
    }
    $owner = strtolower(trim((string)(getenv('PAYDAY_OWNER_EMAIL') ?: ($fileCfg['ownerEmail'] ?? $fileCfg['owner_email'] ?? ''))));
    $user = trim((string)(getenv('GMAIL_USER') ?: ($fileCfg['gmailUser'] ?? $fileCfg['gmail_user'] ?? $owner)));
    $pass = preg_replace('/\s+/', '', (string)(getenv('GMAIL_APP_PASSWORD') ?: ($fileCfg['gmailAppPassword'] ?? $fileCfg['gmail_app_password'] ?? '')));
    return ['ownerEmail' => $owner, 'gmailUser' => $user, 'gmailAppPassword' => $pass];
}

function otpMailConfigured(): bool {
    $cfg = mailConfig();
    return $cfg['ownerEmail'] !== '' && $cfg['gmailUser'] !== '' && $cfg['gmailAppPassword'] !== '';
}

function maskEmail(string $email): string {
    $value = strtolower(trim($email));
    $at = strpos($value, '@');
    if ($at === false || $at < 1) return '';
    $user = substr($value, 0, $at);
    $domain = substr($value, $at + 1);
    $visible = substr($user, 0, min(2, strlen($user)));
    return $visible . str_repeat('*', max(1, strlen($user) - strlen($visible))) . '@' . $domain;
}

function hashOtp(string $code): string {
    return hash('sha256', $code);
}

function smtpRead($socket): array {
    $buf = '';
    while (!feof($socket)) {
        $line = fgets($socket, 515);
        if ($line === false) break;
        $buf .= $line;
        if (preg_match('/^\d{3} /', $line)) break;
    }
    if (!preg_match('/^(\d{3}) /m', $buf, $m)) {
        throw new RuntimeException('Bad SMTP response');
    }
    return ['code' => (int)$m[1], 'text' => $buf];
}

function smtpExpect($socket, array $ok): void {
    $res = smtpRead($socket);
    if (!in_array($res['code'], $ok, true)) {
        throw new RuntimeException('SMTP ' . $res['code'] . ': ' . trim(substr($res['text'], 0, 180)));
    }
}

function smtpCmd($socket, string $line, array $ok): void {
    fwrite($socket, $line . "\r\n");
    smtpExpect($socket, $ok);
}

function sendMailSmtp(string $from, string $to, string $subject, string $text, string $user, string $pass): void {
    $host = getenv('GMAIL_SMTP_HOST') ?: 'smtp.gmail.com';
    $port = (int)(getenv('GMAIL_SMTP_PORT') ?: 587);
    $socket = stream_socket_client('tcp://' . $host . ':' . $port, $errno, $errstr, 30);
    if (!$socket) throw new RuntimeException('Could not connect to Gmail SMTP');
    stream_set_timeout($socket, 30);
    try {
        smtpExpect($socket, [220]);
        smtpCmd($socket, 'EHLO payday-calendar', [250]);
        smtpCmd($socket, 'STARTTLS', [220]);
        if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            throw new RuntimeException('Could not start TLS with Gmail');
        }
        smtpCmd($socket, 'EHLO payday-calendar', [250]);
        smtpCmd($socket, 'AUTH LOGIN', [334]);
        smtpCmd($socket, base64_encode($user), [334]);
        smtpCmd($socket, base64_encode($pass), [235]);
        smtpCmd($socket, 'MAIL FROM:<' . $from . '>', [250]);
        smtpCmd($socket, 'RCPT TO:<' . $to . '>', [250, 251]);
        smtpCmd($socket, 'DATA', [354]);
        $payload = 'From: Payday Calendar <' . $from . ">\r\n"
            . 'To: <' . $to . ">\r\n"
            . 'Subject: ' . $subject . "\r\n"
            . "MIME-Version: 1.0\r\n"
            . "Content-Type: text/plain; charset=utf-8\r\n\r\n"
            . $text . "\r\n.";
        fwrite($socket, $payload . "\r\n");
        smtpExpect($socket, [250]);
        try { smtpCmd($socket, 'QUIT', [221]); } catch (Throwable $ignore) {}
    } finally {
        fclose($socket);
    }
}

function sendLoginOtp(string $code): array {
    $cfg = mailConfig();
    if ($cfg['ownerEmail'] === '' || $cfg['gmailUser'] === '' || $cfg['gmailAppPassword'] === '') {
        throw new InvalidArgumentException('Gmail login is not configured');
    }
    $text = "Your Payday Calendar login code is:\n\n{$code}\n\nThis code expires in 10 minutes.\nIf you did not request it, ignore this email.";
    $debug = getenv('PAYDAY_OTP_DEBUG') === '1';
    if (!$debug) {
        sendMailSmtp(
            $cfg['gmailUser'],
            $cfg['ownerEmail'],
            $code . ' is your Payday Calendar code',
            $text,
            $cfg['gmailUser'],
            $cfg['gmailAppPassword']
        );
    }
    return ['ownerEmail' => $cfg['ownerEmail'], 'debug' => $debug, 'code' => $code];
}

function cleanPin($pin): string {
    $value = trim((string)$pin);
    if (!preg_match('/^\d{4,12}$/', $value)) {
        throw new InvalidArgumentException('Passcode must be 4 to 12 digits');
    }
    return $value;
}

function hashPin(string $pin, ?string $saltHex = null): string {
    $salt = $saltHex !== null ? hex2bin($saltHex) : random_bytes(16);
    if ($salt === false) throw new RuntimeException('bad salt');
    $hash = hash_pbkdf2('sha256', $pin, $salt, AUTH_PBKDF2_ROUNDS, 32, true);
    return 'pbkdf2:' . AUTH_PBKDF2_ROUNDS . ':' . bin2hex($salt) . ':' . bin2hex($hash);
}

function verifyPin($pin, ?string $stored): bool {
    if ($stored === null || $stored === '' || (string)$pin === '') return false;
    $parts = explode(':', $stored);
    if (($parts[0] ?? '') === 'pbkdf2' && count($parts) === 4) {
        $rounds = (int)$parts[1];
        $salt = hex2bin($parts[2]);
        $expected = hex2bin($parts[3]);
        if ($salt === false || $expected === false) return false;
        $hash = hash_pbkdf2('sha256', (string)$pin, $salt, $rounds, strlen($expected), true);
        return hash_equals($expected, $hash);
    }
    return false;
}

function readSessionToken(array $cookies): string {
    return (string)($cookies[AUTH_COOKIE] ?? '');
}

function readSession(PDO $db, array $cookies, bool $touch = false): ?array {
    $token = readSessionToken($cookies);
    if ($token === '') return null;
    $now = (int)round(microtime(true) * 1000);
    $db->prepare('DELETE FROM sessions WHERE expires < ?')->execute([$now]);
    $stmt = $db->prepare('SELECT token, expires FROM sessions WHERE token = ? AND expires >= ?');
    $stmt->execute([$token, $now]);
    $row = $stmt->fetch();
    if (!$row) return null;
    if ($touch) {
        $expires = $now + sessionIdleMs();
        $db->prepare('UPDATE sessions SET expires = ? WHERE token = ?')->execute([$expires, $token]);
        return ['token' => $token, 'expires' => $expires];
    }
    return ['token' => (string)$row['token'], 'expires' => (int)$row['expires']];
}

function createSession(PDO $db): array {
    $token = bin2hex(random_bytes(24));
    $expires = (int)round(microtime(true) * 1000) + sessionIdleMs();
    $db->prepare('INSERT INTO sessions (token, expires) VALUES (?, ?)')->execute([$token, $expires]);
    return ['token' => $token, 'expires' => $expires];
}

function isHttpsRequest(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    $forwarded = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    return strtolower((string)$forwarded) === 'https';
}

function sessionCookieHeader(string $token, int $expiresMs, bool $secure): string {
    $maxAge = max(0, (int)floor(($expiresMs - (microtime(true) * 1000)) / 1000));
    $parts = [
        AUTH_COOKIE . '=' . rawurlencode($token),
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=' . $maxAge,
    ];
    if ($secure) $parts[] = 'Secure';
    return implode('; ', $parts);
}

function clearCookieHeader(bool $secure): string {
    $parts = [AUTH_COOKIE . '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if ($secure) $parts[] = 'Secure';
    return implode('; ', $parts);
}

function getAuthStatus(PDO $db, array $cookies = []): array {
    $lock = $db->query('SELECT enabled, cred_id FROM app_lock WHERE id = 1')->fetch() ?: ['enabled' => 0, 'cred_id' => null];
    $otpEnabled = otpMailConfigured();
    $lockEnabled = !empty($lock['enabled']);
    $loginRequired = $otpEnabled || $lockEnabled;
    $session = $loginRequired ? readSession($db, $cookies, false) : null;
    $cfg = mailConfig();
    return [
        'loginRequired' => $loginRequired,
        'otpEnabled' => $otpEnabled,
        'lockEnabled' => $lockEnabled,
        'authenticated' => $loginRequired ? $session !== null : true,
        'hasServerCred' => !empty($lock['cred_id']),
        'ownerHint' => $otpEnabled ? maskEmail($cfg['ownerEmail']) : '',
        'idleMs' => sessionIdleMs(),
    ];
}

function requireAuth(PDO $db, array $cookies, bool $secure): array {
    $status = getAuthStatus($db, $cookies);
    if (!$status['loginRequired']) return [null, []];
    $session = readSession($db, $cookies, true);
    if ($session === null) {
        return [[401, ['error' => 'locked', 'loginRequired' => true, 'authenticated' => false], []], []];
    }
    return [null, [sessionCookieHeader($session['token'], $session['expires'], $secure)]];
}

function setupLock(PDO $db, array $cookies, $body, bool $secure): array {
    $lock = $db->query('SELECT enabled FROM app_lock WHERE id = 1')->fetch();
    if (!empty($lock['enabled']) && readSession($db, $cookies, false) === null) {
        throw new InvalidArgumentException('Already locked. Unlock first.');
    }
    $pin = cleanPin(is_array($body) ? ($body['pin'] ?? '') : '');
    $credId = substr((string)(is_array($body) ? ($body['credId'] ?? '') : ''), 0, 255);
    $pinHash = hashPin($pin);
    $db->prepare('UPDATE app_lock SET enabled = 1, pin_hash = ?, cred_id = ? WHERE id = 1')
        ->execute([$pinHash, $credId !== '' ? $credId : null]);
    $db->exec('DELETE FROM sessions');
    $session = createSession($db);
    return [
        200,
        ['ok' => true, 'lockEnabled' => true, 'authenticated' => true, 'idleMs' => sessionIdleMs()],
        [sessionCookieHeader($session['token'], $session['expires'], $secure)],
    ];
}

function loginLock(PDO $db, $body, bool $secure): array {
    $lock = $db->query('SELECT enabled, pin_hash, cred_id FROM app_lock WHERE id = 1')->fetch();
    if (empty($lock['enabled'])) {
        if (otpMailConfigured()) throw new RuntimeException('Use the email login code');
        return [200, ['ok' => true, 'lockEnabled' => false, 'authenticated' => true], []];
    }
    $pin = (string)(is_array($body) ? ($body['pin'] ?? '') : '');
    $deviceCred = (string)(is_array($body) ? ($body['credId'] ?? '') : '');
    if (!verifyPin($pin, $lock['pin_hash'] ?? null)) {
        throw new RuntimeException('Wrong passcode');
    }
    if ($deviceCred !== '' && !empty($lock['cred_id']) && $deviceCred !== $lock['cred_id']) {
        throw new RuntimeException('This device is not enrolled');
    }
    $session = createSession($db);
    return [
        200,
        ['ok' => true, 'lockEnabled' => true, 'authenticated' => true, 'idleMs' => sessionIdleMs()],
        [sessionCookieHeader($session['token'], $session['expires'], $secure)],
    ];
}

function logoutLock(PDO $db, array $cookies, bool $secure): array {
    $token = readSessionToken($cookies);
    if ($token !== '') $db->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
    return [200, ['ok' => true], [clearCookieHeader($secure)]];
}

function disableLockAuth(PDO $db, $body, bool $secure): array {
    $lock = $db->query('SELECT enabled, pin_hash FROM app_lock WHERE id = 1')->fetch();
    if (empty($lock['enabled'])) {
        return [200, ['ok' => true, 'lockEnabled' => false, 'authenticated' => true], [clearCookieHeader($secure)]];
    }
    $pin = is_array($body) ? ($body['pin'] ?? '') : '';
    if (!verifyPin($pin, $lock['pin_hash'] ?? null)) {
        throw new RuntimeException('Wrong passcode');
    }
    $db->exec('UPDATE app_lock SET enabled = 0, pin_hash = NULL, cred_id = NULL WHERE id = 1');
    if (!otpMailConfigured()) $db->exec('DELETE FROM sessions');
    return [200, ['ok' => true, 'lockEnabled' => false, 'authenticated' => true], [clearCookieHeader($secure)]];
}

function requestOtp(PDO $db, $body): array {
    $cfg = mailConfig();
    if ($cfg['ownerEmail'] === '' || $cfg['gmailUser'] === '' || $cfg['gmailAppPassword'] === '') {
        throw new InvalidArgumentException('Gmail login is not configured');
    }
    $email = strtolower(trim((string)(is_array($body) ? ($body['email'] ?? '') : '')));
    if ($email === '' || $email !== $cfg['ownerEmail']) {
        throw new InvalidArgumentException('That email cannot sign in');
    }
    $now = (int)round(microtime(true) * 1000);
    $stmt = $db->prepare('SELECT sent_at FROM otp_codes WHERE email = ?');
    $stmt->execute([$email]);
    $existing = $stmt->fetch();
    if ($existing && ($now - (int)$existing['sent_at']) < AUTH_OTP_RESEND_MS) {
        throw new InvalidArgumentException('Wait a minute before requesting another code');
    }
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $expires = $now + AUTH_OTP_TTL_MS;
    $db->prepare('DELETE FROM otp_codes WHERE email = ?')->execute([$email]);
    $db->prepare('INSERT INTO otp_codes (email, code_hash, expires, attempts, sent_at) VALUES (?, ?, ?, 0, ?)')
        ->execute([$email, hashOtp($code), $expires, $now]);
    $sent = sendLoginOtp($code);
    $result = [
        'ok' => true,
        'sent' => true,
        'ownerHint' => maskEmail($email),
        'expiresInSec' => (int)floor(AUTH_OTP_TTL_MS / 1000),
    ];
    if (!empty($sent['debug'])) $result['debugCode'] = $code;
    return $result;
}

function verifyOtp(PDO $db, $body, bool $secure): array {
    $cfg = mailConfig();
    if ($cfg['ownerEmail'] === '') throw new InvalidArgumentException('Gmail login is not configured');
    $email = strtolower(trim((string)(is_array($body) ? ($body['email'] ?? '') : '')));
    $code = trim((string)(is_array($body) ? ($body['code'] ?? '') : ''));
    if ($email !== $cfg['ownerEmail']) throw new InvalidArgumentException('That email cannot sign in');
    if (!preg_match('/^\d{6}$/', $code)) throw new InvalidArgumentException('Enter the 6-digit code');
    $now = (int)round(microtime(true) * 1000);
    $db->prepare('DELETE FROM otp_codes WHERE expires < ?')->execute([$now]);
    $stmt = $db->prepare('SELECT code_hash, expires, attempts FROM otp_codes WHERE email = ?');
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    if (!$row || (int)$row['expires'] < $now) throw new RuntimeException('Code expired. Request a new one.');
    if ((int)$row['attempts'] >= AUTH_OTP_MAX_ATTEMPTS) throw new RuntimeException('Too many tries. Request a new code.');
    if (hashOtp($code) !== $row['code_hash']) {
        $db->prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?')->execute([$email]);
        throw new RuntimeException('Wrong code');
    }
    $db->prepare('DELETE FROM otp_codes WHERE email = ?')->execute([$email]);
    $session = createSession($db);
    return [
        200,
        ['ok' => true, 'authenticated' => true, 'loginRequired' => true, 'idleMs' => sessionIdleMs()],
        [sessionCookieHeader($session['token'], $session['expires'], $secure)],
    ];
}

function touchAuth(PDO $db, array $cookies, bool $secure): array {
    $status = getAuthStatus($db, $cookies);
    if (!$status['loginRequired']) {
        return [200, ['ok' => true, 'authenticated' => true, 'idleMs' => sessionIdleMs()], []];
    }
    $session = readSession($db, $cookies, true);
    if ($session === null) {
        return [401, ['ok' => false, 'authenticated' => false, 'loginRequired' => true], []];
    }
    return [
        200,
        ['ok' => true, 'authenticated' => true, 'idleMs' => sessionIdleMs(), 'expiresAt' => $session['expires']],
        [sessionCookieHeader($session['token'], $session['expires'], $secure)],
    ];
}

function ensureDebtColumns(PDO $db): void {
    $cols = [];
    foreach ($db->query('PRAGMA table_info(debts)') as $row) $cols[$row['name']] = true;
    if (!isset($cols['payment'])) $db->exec('ALTER TABLE debts ADD COLUMN payment REAL');
    if (!isset($cols['every_days'])) $db->exec('ALTER TABLE debts ADD COLUMN every_days INTEGER NOT NULL DEFAULT 14');
}

function utcStamp(string $ymd): int {
    $parts = explode('-', $ymd);
    return gmmktime(0, 0, 0, (int)$parts[1], (int)$parts[2], (int)$parts[0]);
}

function dayDiff(string $a, string $b): int {
    return (int)round((utcStamp($b) - utcStamp($a)) / 86400);
}

function onCompanyThursdays(?string $anchor): bool {
    if (!$anchor) return false;
    return (int)gmdate('w', utcStamp($anchor)) === 4 && abs(dayDiff('2026-10-01', $anchor)) % 14 === 0;
}

function migrateCompany(PDO $db): void {
    $jobs = $db->query('SELECT id, freq, anchor, lag FROM jobs')->fetchAll();
    $update = $db->prepare("UPDATE jobs SET freq = 'biweeklyThu', anchor = '2026-10-01', week_end = 'sun', lag = 0 WHERE id = ?");
    foreach ($jobs as $job) {
        if ($job['freq'] === 'biweekly' && !((int)$job['lag'] > 0) && onCompanyThursdays($job['anchor'])) {
            $update->execute([$job['id']]);
        }
    }
}

function companySchedule(): array {
    return ['id' => 'company', 'name' => 'My company', 'freq' => 'biweeklyThu', 'anchor' => '2026-10-01', 'weekEnd' => 'sun', 'lag' => 0, 'rate' => '', 'color' => 0];
}

function cleanJob(array $job, int $position): array {
    $freq = in_array($job['freq'] ?? '', FREQS, true) ? $job['freq'] : 'biweeklyThu';
    $rawRate = $job['rate'] ?? null;
    $rate = ($rawRate === '' || $rawRate === null || !is_numeric($rawRate)) ? null : (float)$rawRate;
    $anchor = $job['anchor'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $anchor)) $anchor = '2026-10-01';
    $id = substr((string)($job['id'] ?? ''), 0, 40);
    $name = trim(substr((string)($job['name'] ?? 'My job'), 0, 40));
    return [
        'id' => $id !== '' ? $id : 'job',
        'name' => $name !== '' ? $name : 'My job',
        'freq' => $freq,
        'anchor' => $anchor,
        'weekEnd' => (($job['weekEnd'] ?? '') === 'sat') ? 'sat' : 'sun',
        'lag' => max(0, min(30, (int)($job['lag'] ?? 0))),
        'rate' => $rate,
        'color' => max(0, min(5, (int)($job['color'] ?? 0))),
        'position' => $position,
    ];
}

function saveJobs(PDO $db, $jobs): void {
    $list = is_array($jobs) ? $jobs : [];
    $insert = $db->prepare('INSERT INTO jobs (id, name, freq, anchor, week_end, lag, rate, color, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $db->beginTransaction();
    try {
        $db->exec('DELETE FROM jobs');
        $seen = [];
        foreach (array_values($list) as $i => $job) {
            if (!is_array($job)) continue;
            $row = cleanJob($job, $i);
            if (isset($seen[$row['id']])) continue;
            $seen[$row['id']] = true;
            $insert->execute([$row['id'], $row['name'], $row['freq'], $row['anchor'], $row['weekEnd'], $row['lag'], $row['rate'], $row['color'], $row['position']]);
        }
        $db->commit();
    } catch (Throwable $err) {
        if ($db->inTransaction()) $db->rollBack();
        throw $err;
    }
}

function nextMonth(string $ym): string {
    $parts = array_map('intval', explode('-', $ym));
    $y = $parts[0];
    $m = $parts[1] + 1;
    if ($m > 12) { $m = 1; $y += 1; }
    return sprintf('%04d-%02d', $y, $m);
}

function saveMonth(PDO $db, string $ym, $days): void {
    if (!preg_match('/^\d{4}-\d{2}$/', $ym)) throw new InvalidArgumentException('bad month');
    $insert = $db->prepare('INSERT INTO entries (id, day, job_id, hours, amount) VALUES (?, ?, ?, ?, ?)');
    $delete = $db->prepare('DELETE FROM entries WHERE day >= ? AND day < ?');
    $db->beginTransaction();
    try {
        $delete->execute([$ym . '-01', nextMonth($ym) . '-01']);
        $seen = [];
        foreach ((is_array($days) ? $days : []) as $day => $entries) {
            if (!is_string($day) || !str_starts_with($day, $ym . '-')) continue;
            foreach ((is_array($entries) ? $entries : []) as $entry) {
                if (!is_array($entry)) continue;
                $id = (string)($entry['id'] ?? '');
                if ($id === '' || isset($seen[$id])) continue;
                $seen[$id] = true;
                $amount = round(((float)($entry['amount'] ?? 0)) * 100) / 100;
                $insert->execute([$id, $day, (string)($entry['job'] ?? ''), (float)($entry['hours'] ?? 0), $amount]);
            }
        }
        $db->commit();
    } catch (Throwable $err) {
        if ($db->inTransaction()) $db->rollBack();
        throw $err;
    }
}

function jobFromRow(array $row): array {
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'freq' => $row['freq'],
        'anchor' => $row['anchor'],
        'weekEnd' => ($row['week_end'] === 'sat') ? 'sat' : 'sun',
        'lag' => (int)$row['lag'],
        'rate' => $row['rate'] === null ? '' : (float)$row['rate'],
        'color' => (int)$row['color'],
    ];
}

function money2(float $n): float {
    return round($n * 100) / 100;
}

function cleanDebt(array $debt, int $position): array {
    $opened = $debt['opened'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $opened)) $opened = '2026-10-01';
    $id = substr((string)($debt['id'] ?? ''), 0, 40);
    $name = trim(substr((string)($debt['name'] ?? 'Debt'), 0, 60));
    $rawPay = $debt['payment'] ?? null;
    $payment = ($rawPay === '' || $rawPay === null || !is_numeric($rawPay))
        ? null
        : money2(max(0, (float)$rawPay));
    $every = (int)($debt['everyDays'] ?? 14);
    if (!in_array($every, [7, 14, 30], true)) $every = 14;
    return [
        'id' => $id !== '' ? $id : 'debt',
        'name' => $name !== '' ? $name : 'Debt',
        'total' => money2(max(0, (float)($debt['total'] ?? 0))),
        'note' => trim(substr((string)($debt['note'] ?? ''), 0, 200)),
        'opened' => $opened,
        'payment' => $payment,
        'everyDays' => $every,
        'position' => $position,
        'payments' => is_array($debt['payments'] ?? null) ? $debt['payments'] : [],
    ];
}

function cleanPayment(array $payment, string $debtId): ?array {
    $day = $payment['day'] ?? '';
    $id = (string)($payment['id'] ?? '');
    if ($id === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) return null;
    return [
        'id' => substr($id, 0, 40),
        'debtId' => $debtId,
        'day' => $day,
        'amount' => money2(max(0, (float)($payment['amount'] ?? 0))),
        'note' => trim(substr((string)($payment['note'] ?? ''), 0, 200)),
    ];
}

function saveDebts(PDO $db, $debts): void {
    $list = is_array($debts) ? $debts : [];
    $insertDebt = $db->prepare('INSERT INTO debts (id, name, total, note, opened, payment, every_days, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $insertPay = $db->prepare('INSERT INTO debt_payments (id, debt_id, day, amount, note) VALUES (?, ?, ?, ?, ?)');
    $db->beginTransaction();
    try {
        $db->exec('DELETE FROM debt_payments');
        $db->exec('DELETE FROM debts');
        $seenDebts = [];
        $seenPays = [];
        foreach (array_values($list) as $i => $debt) {
            if (!is_array($debt)) continue;
            $row = cleanDebt($debt, $i);
            if (isset($seenDebts[$row['id']])) continue;
            $seenDebts[$row['id']] = true;
            $insertDebt->execute([$row['id'], $row['name'], $row['total'], $row['note'], $row['opened'], $row['payment'], $row['everyDays'], $row['position']]);
            foreach ($row['payments'] as $payment) {
                if (!is_array($payment)) continue;
                $pay = cleanPayment($payment, $row['id']);
                if ($pay === null || isset($seenPays[$pay['id']])) continue;
                $seenPays[$pay['id']] = true;
                $insertPay->execute([$pay['id'], $pay['debtId'], $pay['day'], $pay['amount'], $pay['note']]);
            }
        }
        $db->commit();
    } catch (Throwable $err) {
        if ($db->inTransaction()) $db->rollBack();
        throw $err;
    }
}

function getState(PDO $db): array {
    $count = (int)$db->query('SELECT COUNT(*) AS n FROM jobs')->fetch()['n'];
    if ($count === 0) saveJobs($db, [companySchedule()]);
    $jobs = [];
    foreach ($db->query('SELECT * FROM jobs ORDER BY position ASC, name ASC') as $row) $jobs[] = jobFromRow($row);
    $months = [];
    foreach ($db->query('SELECT id, day, job_id, hours, amount FROM entries ORDER BY day ASC') as $row) {
        $mk = substr($row['day'], 0, 7);
        if (!isset($months[$mk])) $months[$mk] = ['days' => []];
        if (!isset($months[$mk]['days'][$row['day']])) $months[$mk]['days'][$row['day']] = [];
        $months[$mk]['days'][$row['day']][] = [
            'id' => $row['id'],
            'job' => $row['job_id'],
            'hours' => (float)$row['hours'],
            'amount' => (float)$row['amount'],
        ];
    }
    $paymentsByDebt = [];
    foreach ($db->query('SELECT id, debt_id, day, amount, note FROM debt_payments ORDER BY day ASC, id ASC') as $row) {
        if (!isset($paymentsByDebt[$row['debt_id']])) $paymentsByDebt[$row['debt_id']] = [];
        $paymentsByDebt[$row['debt_id']][] = [
            'id' => $row['id'],
            'day' => $row['day'],
            'amount' => money2((float)$row['amount']),
            'note' => (string)($row['note'] ?? ''),
        ];
    }
    $debts = [];
    foreach ($db->query('SELECT * FROM debts ORDER BY position ASC, name ASC') as $row) {
        $payments = $paymentsByDebt[$row['id']] ?? [];
        $paid = 0.0;
        foreach ($payments as $payment) $paid += $payment['amount'];
        $paid = money2($paid);
        $total = money2((float)$row['total']);
        $payment = $row['payment'] === null || $row['payment'] === '' ? '' : money2((float)$row['payment']);
        $everyDays = max(1, (int)($row['every_days'] ?? 14));
        $debts[] = [
            'id' => $row['id'],
            'name' => $row['name'],
            'total' => $total,
            'note' => (string)($row['note'] ?? ''),
            'opened' => $row['opened'],
            'payment' => $payment,
            'everyDays' => $everyDays,
            'paid' => $paid,
            'remaining' => money2(max(0, $total - $paid)),
            'payments' => $payments,
        ];
    }
    return ['jobs' => $jobs, 'months' => $months, 'debts' => $debts];
}

function jsonBody($value): string {
    return json_encode($value, JSON_UNESCAPED_SLASHES);
}

function handleRequest(string $method, string $route, $payload, PDO $db, array $cookies = [], ?bool $secure = null): array {
    $secure = $secure ?? isHttpsRequest();
    try {
        if ($method === 'GET' && $route === 'auth/status') {
            return [200, getAuthStatus($db, $cookies), []];
        }
        if ($method === 'POST' && $route === 'auth/otp/request') {
            return [200, requestOtp($db, $payload), []];
        }
        if ($method === 'POST' && $route === 'auth/otp/verify') {
            return verifyOtp($db, $payload, $secure);
        }
        if ($method === 'POST' && $route === 'auth/touch') {
            return touchAuth($db, $cookies, $secure);
        }
        if ($method === 'POST' && $route === 'auth/setup') {
            return setupLock($db, $cookies, $payload, $secure);
        }
        if ($method === 'POST' && $route === 'auth/login') {
            return loginLock($db, $payload, $secure);
        }
        if ($method === 'POST' && $route === 'auth/logout') {
            return logoutLock($db, $cookies, $secure);
        }
        if ($method === 'POST' && $route === 'auth/disable') {
            return disableLockAuth($db, $payload, $secure);
        }

        [$blocked, $touchCookies] = requireAuth($db, $cookies, $secure);
        if ($blocked !== null) return $blocked;

        if ($method === 'GET' && $route === 'state') return [200, getState($db), $touchCookies];
        if ($method === 'PUT' && $route === 'jobs') {
            saveJobs($db, is_array($payload) ? ($payload['jobs'] ?? []) : []);
            return [200, ['ok' => true], $touchCookies];
        }
        if ($method === 'PUT' && preg_match('#^months/(\d{4}-\d{2})$#', $route, $match)) {
            saveMonth($db, $match[1], is_array($payload) ? ($payload['days'] ?? []) : []);
            return [200, ['ok' => true], $touchCookies];
        }
        if ($method === 'PUT' && $route === 'debts') {
            saveDebts($db, is_array($payload) ? ($payload['debts'] ?? []) : []);
            return [200, ['ok' => true], $touchCookies];
        }
        return [404, ['error' => 'not found'], []];
    } catch (InvalidArgumentException $err) {
        return [400, ['error' => $err->getMessage()], []];
    } catch (RuntimeException $err) {
        $code = str_contains($err->getMessage(), 'Wrong')
            || str_contains($err->getMessage(), 'enrolled')
            || str_contains($err->getMessage(), 'expired')
            || str_contains($err->getMessage(), 'tries')
            ? 401 : 400;
        return [$code, ['error' => $err->getMessage()], []];
    } catch (Throwable $err) {
        return [400, ['error' => 'Could not save'], []];
    }
}

if (PHP_SAPI !== 'cli') {
    $route = isset($_GET['route']) ? (string)$_GET['route'] : '';
    $payload = json_decode(file_get_contents('php://input') ?: '', true);
    [$status, $body, $setCookies] = handleRequest(
        $_SERVER['REQUEST_METHOD'] ?? 'GET',
        $route,
        $payload,
        openDb(),
        $_COOKIE,
        isHttpsRequest()
    );
    http_response_code($status);
    header('Content-Type: application/json');
    foreach ($setCookies as $cookie) header('Set-Cookie: ' . $cookie, false);
    if ($status === 200 && isset($body['months']) && $body['months'] === []) $body['months'] = new stdClass();
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
}
