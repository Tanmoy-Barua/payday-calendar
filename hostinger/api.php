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
    return $db;
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

function handleRequest(string $method, string $route, $payload, PDO $db): array {
    try {
        if ($method === 'GET' && $route === 'state') return [200, getState($db)];
        if ($method === 'PUT' && $route === 'jobs') {
            saveJobs($db, is_array($payload) ? ($payload['jobs'] ?? []) : []);
            return [200, ['ok' => true]];
        }
        if ($method === 'PUT' && preg_match('#^months/(\d{4}-\d{2})$#', $route, $match)) {
            saveMonth($db, $match[1], is_array($payload) ? ($payload['days'] ?? []) : []);
            return [200, ['ok' => true]];
        }
        if ($method === 'PUT' && $route === 'debts') {
            saveDebts($db, is_array($payload) ? ($payload['debts'] ?? []) : []);
            return [200, ['ok' => true]];
        }
        return [404, ['error' => 'not found']];
    } catch (InvalidArgumentException $err) {
        return [400, ['error' => $err->getMessage()]];
    } catch (Throwable $err) {
        return [400, ['error' => 'Could not save']];
    }
}

if (PHP_SAPI !== 'cli') {
    $route = isset($_GET['route']) ? (string)$_GET['route'] : '';
    $payload = json_decode(file_get_contents('php://input') ?: '', true);
    [$status, $body] = handleRequest($_SERVER['REQUEST_METHOD'] ?? 'GET', $route, $payload, openDb());
    http_response_code($status);
    header('Content-Type: application/json');
    $flags = JSON_UNESCAPED_SLASHES;
    if ($status === 200 && isset($body['months']) && $body['months'] === []) $body['months'] = new stdClass();
    echo json_encode($body, $flags);
}
