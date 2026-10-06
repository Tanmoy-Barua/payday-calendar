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
    ');
    migrateCompany($db);
    return $db;
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
    return ['jobs' => $jobs, 'months' => $months];
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
