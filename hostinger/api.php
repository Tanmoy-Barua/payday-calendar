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
    ensureBudgetTables($db);
    return $db;
}

function ensureBudgetTables(PDO $db): void {
    $db->exec('
        CREATE TABLE IF NOT EXISTS budget_notes (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          title TEXT NOT NULL DEFAULT \'Budget Note\',
          starting REAL NOT NULL DEFAULT 2200,
          paycheck_date TEXT NOT NULL DEFAULT \'\',
          paycheck_label TEXT NOT NULL DEFAULT \'\',
          job_id TEXT NOT NULL DEFAULT \'\'
        );
        CREATE TABLE IF NOT EXISTS budget_items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT \'\',
          amount REAL,
          paid INTEGER NOT NULL DEFAULT 0,
          separate INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS budget_history (
          id TEXT PRIMARY KEY,
          paycheck_date TEXT NOT NULL DEFAULT \'\',
          paycheck_label TEXT NOT NULL DEFAULT \'\',
          job_id TEXT NOT NULL DEFAULT \'\',
          starting REAL NOT NULL,
          remaining REAL NOT NULL,
          closed_at TEXT NOT NULL,
          items_json TEXT NOT NULL,
          paid_json TEXT NOT NULL DEFAULT \'[]\'
        );
    ');
    $cols = [];
    foreach ($db->query('PRAGMA table_info(budget_notes)') as $row) $cols[$row['name']] = true;
    if (!isset($cols['paycheck_date'])) $db->exec("ALTER TABLE budget_notes ADD COLUMN paycheck_date TEXT NOT NULL DEFAULT ''");
    if (!isset($cols['paycheck_label'])) $db->exec("ALTER TABLE budget_notes ADD COLUMN paycheck_label TEXT NOT NULL DEFAULT ''");
    if (!isset($cols['job_id'])) $db->exec("ALTER TABLE budget_notes ADD COLUMN job_id TEXT NOT NULL DEFAULT ''");
}

function defaultBudgetNote(): array {
    $main = [];
    foreach ([600, 360, 100, 250, 500, 167, 60, 89] as $i => $amount) {
        $main[] = [
            'id' => 'pay-' . ($i + 1),
            'name' => '',
            'amount' => $amount,
            'paid' => false,
            'separate' => false,
        ];
    }
    $separate = [
        ['id' => 'sep-prime', 'name' => 'Prime', 'amount' => 50, 'paid' => false, 'separate' => true],
        ['id' => 'sep-credit-one', 'name' => 'Credit One', 'amount' => '', 'paid' => false, 'separate' => true],
        ['id' => 'sep-capital-one', 'name' => 'Capital One', 'amount' => '', 'paid' => false, 'separate' => true],
        ['id' => 'sep-apple', 'name' => 'Apple Card', 'amount' => '', 'paid' => false, 'separate' => true],
        ['id' => 'sep-chevron', 'name' => 'Chevron Card', 'amount' => '', 'paid' => false, 'separate' => true],
        ['id' => 'sep-45', 'name' => '', 'amount' => 45, 'paid' => false, 'separate' => true],
        ['id' => 'sep-40', 'name' => '', 'amount' => 40, 'paid' => false, 'separate' => true],
    ];
    return [
        'title' => 'Budget Note',
        'starting' => 2200,
        'paycheckDate' => '',
        'paycheckLabel' => '',
        'jobId' => '',
        'items' => array_merge($main, $separate),
        'history' => [],
    ];
}

function cleanBudgetItem(array $item, int $position): array {
    $raw = $item['amount'] ?? null;
    $amount = ($raw === '' || $raw === null || !is_numeric($raw))
        ? null
        : money2(max(0, (float)$raw));
    $id = substr((string)($item['id'] ?? ''), 0, 40);
    return [
        'id' => $id !== '' ? $id : ('item-' . $position),
        'name' => trim(substr((string)($item['name'] ?? ''), 0, 60)),
        'amount' => $amount,
        'paid' => !empty($item['paid']) ? 1 : 0,
        'separate' => !empty($item['separate']) ? 1 : 0,
        'position' => $position,
    ];
}

function cleanHistoryEntry(array $entry): array {
    $id = substr((string)($entry['id'] ?? ''), 0, 40);
    if ($id === '') $id = 'hist-' . bin2hex(random_bytes(4));
    $closedAt = $entry['closedAt'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $closedAt)) $closedAt = '2026-10-01';
    $paycheckDate = $entry['paycheckDate'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $paycheckDate)) $paycheckDate = $closedAt;
    $label = trim(substr((string)($entry['paycheckLabel'] ?? 'Paycheck'), 0, 120));
    return [
        'id' => $id,
        'paycheckDate' => $paycheckDate,
        'paycheckLabel' => $label !== '' ? $label : 'Paycheck',
        'jobId' => substr((string)($entry['jobId'] ?? ''), 0, 40),
        'starting' => money2(max(0, (float)($entry['starting'] ?? 0))),
        'remaining' => money2((float)($entry['remaining'] ?? 0)),
        'closedAt' => $closedAt,
        'itemsJson' => json_encode(is_array($entry['items'] ?? null) ? $entry['items'] : [], JSON_UNESCAPED_SLASHES),
        'paidJson' => json_encode(is_array($entry['paid'] ?? null) ? $entry['paid'] : [], JSON_UNESCAPED_SLASHES),
    ];
}

function saveBudget(PDO $db, $budget): void {
    ensureBudgetTables($db);
    $title = trim(substr((string)(is_array($budget) ? ($budget['title'] ?? 'Budget Note') : 'Budget Note'), 0, 60));
    if ($title === '') $title = 'Budget Note';
    $rawStart = is_array($budget) ? ($budget['starting'] ?? 2200) : 2200;
    $starting = ($rawStart === '' || $rawStart === null || !is_numeric($rawStart))
        ? 2200.0
        : money2(max(0, (float)$rawStart));
    $paycheckDate = is_array($budget) ? (string)($budget['paycheckDate'] ?? '') : '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $paycheckDate)) $paycheckDate = '';
    $paycheckLabel = trim(substr((string)(is_array($budget) ? ($budget['paycheckLabel'] ?? '') : ''), 0, 120));
    $jobId = substr((string)(is_array($budget) ? ($budget['jobId'] ?? '') : ''), 0, 40);
    $list = is_array($budget) && is_array($budget['items'] ?? null) ? $budget['items'] : [];
    $history = is_array($budget) && is_array($budget['history'] ?? null) ? $budget['history'] : [];
    $insert = $db->prepare('INSERT INTO budget_items (id, name, amount, paid, separate, position) VALUES (?, ?, ?, ?, ?, ?)');
    $insertHistory = $db->prepare('INSERT INTO budget_history (id, paycheck_date, paycheck_label, job_id, starting, remaining, closed_at, items_json, paid_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $db->beginTransaction();
    try {
        $db->exec('DELETE FROM budget_notes');
        $db->prepare('INSERT INTO budget_notes (id, title, starting, paycheck_date, paycheck_label, job_id) VALUES (1, ?, ?, ?, ?, ?)')
            ->execute([$title, $starting, $paycheckDate, $paycheckLabel, $jobId]);
        $db->exec('DELETE FROM budget_items');
        $seen = [];
        foreach (array_values($list) as $i => $item) {
            if (!is_array($item)) continue;
            $row = cleanBudgetItem($item, $i);
            if (isset($seen[$row['id']])) continue;
            $seen[$row['id']] = true;
            $insert->execute([$row['id'], $row['name'], $row['amount'], $row['paid'], $row['separate'], $row['position']]);
        }
        $db->exec('DELETE FROM budget_history');
        $seenHist = [];
        foreach ($history as $entry) {
            if (!is_array($entry)) continue;
            $row = cleanHistoryEntry($entry);
            if (isset($seenHist[$row['id']])) continue;
            $seenHist[$row['id']] = true;
            $insertHistory->execute([
                $row['id'],
                $row['paycheckDate'],
                $row['paycheckLabel'],
                $row['jobId'],
                $row['starting'],
                $row['remaining'],
                $row['closedAt'],
                $row['itemsJson'],
                $row['paidJson'],
            ]);
        }
        $db->commit();
    } catch (Throwable $err) {
        if ($db->inTransaction()) $db->rollBack();
        throw $err;
    }
}

function getBudget(PDO $db): array {
    ensureBudgetTables($db);
    $note = $db->query('SELECT * FROM budget_notes WHERE id = 1')->fetch();
    $count = (int)$db->query('SELECT COUNT(*) AS n FROM budget_items')->fetch()['n'];
    if (!$note || $count === 0) {
        $seeded = defaultBudgetNote();
        saveBudget($db, $seeded);
        return $seeded;
    }
    $items = [];
    foreach ($db->query('SELECT * FROM budget_items ORDER BY separate ASC, position ASC, id ASC') as $row) {
        $items[] = [
            'id' => $row['id'],
            'name' => (string)($row['name'] ?? ''),
            'amount' => $row['amount'] === null ? '' : money2((float)$row['amount']),
            'paid' => !empty($row['paid']),
            'separate' => !empty($row['separate']),
        ];
    }
    $history = [];
    foreach ($db->query('SELECT * FROM budget_history ORDER BY closed_at DESC, id DESC') as $row) {
        $decodedItems = json_decode((string)($row['items_json'] ?? '[]'), true);
        $decodedPaid = json_decode((string)($row['paid_json'] ?? '[]'), true);
        $history[] = [
            'id' => $row['id'],
            'paycheckDate' => (string)($row['paycheck_date'] ?? ''),
            'paycheckLabel' => (string)($row['paycheck_label'] ?? ''),
            'jobId' => (string)($row['job_id'] ?? ''),
            'starting' => money2((float)$row['starting']),
            'remaining' => money2((float)$row['remaining']),
            'closedAt' => (string)($row['closed_at'] ?? ''),
            'items' => is_array($decodedItems) ? $decodedItems : [],
            'paid' => is_array($decodedPaid) ? $decodedPaid : [],
        ];
    }
    return [
        'title' => (string)($note['title'] ?? 'Budget Note'),
        'starting' => money2((float)$note['starting']),
        'paycheckDate' => (string)($note['paycheck_date'] ?? ''),
        'paycheckLabel' => (string)($note['paycheck_label'] ?? ''),
        'jobId' => (string)($note['job_id'] ?? ''),
        'items' => $items,
        'history' => $history,
    ];
}

const AUTH_COOKIE = 'payday_session';
const AUTH_SESSION_HOURS = 12;
const AUTH_PBKDF2_ROUNDS = 120000;

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
    ');
    $row = $db->query('SELECT id FROM app_lock WHERE id = 1')->fetch();
    if (!$row) $db->exec('INSERT INTO app_lock (id, enabled) VALUES (1, 0)');
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

function readSession(PDO $db, array $cookies): ?string {
    $token = readSessionToken($cookies);
    if ($token === '') return null;
    $now = (int)round(microtime(true) * 1000);
    $db->prepare('DELETE FROM sessions WHERE expires < ?')->execute([$now]);
    $stmt = $db->prepare('SELECT token FROM sessions WHERE token = ? AND expires >= ?');
    $stmt->execute([$token, $now]);
    $row = $stmt->fetch();
    return $row ? (string)$row['token'] : null;
}

function createSession(PDO $db): array {
    $token = bin2hex(random_bytes(24));
    $expires = (int)round(microtime(true) * 1000) + AUTH_SESSION_HOURS * 3600 * 1000;
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
    $enabled = !empty($lock['enabled']);
    $authenticated = $enabled ? readSession($db, $cookies) !== null : true;
    return [
        'lockEnabled' => $enabled,
        'authenticated' => $authenticated,
        'hasServerCred' => !empty($lock['cred_id']),
    ];
}

function requireAuth(PDO $db, array $cookies): ?array {
    $status = getAuthStatus($db, $cookies);
    if (!$status['lockEnabled'] || $status['authenticated']) return null;
    return [401, ['error' => 'locked', 'lockEnabled' => true, 'authenticated' => false], []];
}

function setupLock(PDO $db, array $cookies, $body, bool $secure): array {
    $lock = $db->query('SELECT enabled FROM app_lock WHERE id = 1')->fetch();
    if (!empty($lock['enabled']) && readSession($db, $cookies) === null) {
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
        ['ok' => true, 'lockEnabled' => true, 'authenticated' => true],
        [sessionCookieHeader($session['token'], $session['expires'], $secure)],
    ];
}

function loginLock(PDO $db, $body, bool $secure): array {
    $lock = $db->query('SELECT enabled, pin_hash, cred_id FROM app_lock WHERE id = 1')->fetch();
    if (empty($lock['enabled'])) {
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
        ['ok' => true, 'lockEnabled' => true, 'authenticated' => true],
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
    $db->exec('DELETE FROM sessions');
    return [200, ['ok' => true, 'lockEnabled' => false, 'authenticated' => true], [clearCookieHeader($secure)]];
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
    return ['jobs' => $jobs, 'months' => $months, 'debts' => $debts, 'budget' => getBudget($db)];
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

        $blocked = requireAuth($db, $cookies);
        if ($blocked !== null) return $blocked;

        if ($method === 'GET' && $route === 'state') return [200, getState($db), []];
        if ($method === 'PUT' && $route === 'jobs') {
            saveJobs($db, is_array($payload) ? ($payload['jobs'] ?? []) : []);
            return [200, ['ok' => true], []];
        }
        if ($method === 'PUT' && preg_match('#^months/(\d{4}-\d{2})$#', $route, $match)) {
            saveMonth($db, $match[1], is_array($payload) ? ($payload['days'] ?? []) : []);
            return [200, ['ok' => true], []];
        }
        if ($method === 'PUT' && $route === 'debts') {
            saveDebts($db, is_array($payload) ? ($payload['debts'] ?? []) : []);
            return [200, ['ok' => true], []];
        }
        if ($method === 'PUT' && $route === 'budget') {
            saveBudget($db, is_array($payload) ? ($payload['budget'] ?? []) : []);
            return [200, ['ok' => true], []];
        }
        return [404, ['error' => 'not found'], []];
    } catch (InvalidArgumentException $err) {
        return [400, ['error' => $err->getMessage()], []];
    } catch (RuntimeException $err) {
        $code = str_contains($err->getMessage(), 'Wrong') || str_contains($err->getMessage(), 'enrolled') ? 401 : 400;
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
