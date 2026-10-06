<?php
declare(strict_types=1);

require __DIR__ . '/api.php';

$file = sys_get_temp_dir() . '/payday-php-' . getmypid() . '.sqlite';
@unlink($file);
putenv('PAYDAY_DB=' . $file);
$db = openDb();

[$status, $state] = handleRequest('GET', 'state', null, $db);
assert($status === 200, 'state status');
assert($state['jobs'][0]['id'] === 'company', 'seeded company');
assert($state['jobs'][0]['freq'] === 'biweeklyThu', 'company frequency');
assert($state['months'] === [], 'no months yet');

[$status] = handleRequest('PUT', 'months/2026-10', [
    'days' => ['2026-10-06' => [['id' => 'e1', 'job' => 'company', 'hours' => 8, 'amount' => 147.52]]],
], $db);
assert($status === 200, 'save month');

[$status] = handleRequest('PUT', 'jobs', [
    'jobs' => [
        $state['jobs'][0],
        ['id' => 'weekend', 'name' => 'Weekend', 'freq' => 'weekly', 'anchor' => '2026-10-02', 'weekEnd' => 'sun', 'lag' => 0, 'rate' => 20, 'color' => 1],
    ],
], $db);
assert($status === 200, 'save jobs');

$again = openDb();
[$status, $state] = handleRequest('GET', 'state', null, $again);
assert($state['jobs'][1]['name'] === 'Weekend', 'second job kept');
assert($state['jobs'][1]['rate'] === 20.0, 'rate kept');
assert($state['months']['2026-10']['days']['2026-10-06'][0]['amount'] === 147.52, 'amount kept');

[$status] = handleRequest('PUT', 'months/2026-10', ['days' => []], $again);
[$status, $cleared] = handleRequest('GET', 'state', null, $again);
assert(!isset($cleared['months']['2026-10']), 'month cleared');
assert(handleRequest('PUT', 'months/nope', ['days' => []], $again)[0] === 400, 'bad month');

echo "php api ok\n";
@unlink($file);
