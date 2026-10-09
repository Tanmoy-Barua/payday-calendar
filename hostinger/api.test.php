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
assert($state['debts'] === [], 'no debts yet');

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

[$status] = handleRequest('PUT', 'debts', [
    'debts' => [[
        'id' => 'car',
        'name' => 'Car loan',
        'total' => 1200,
        'note' => 'Monthly payment',
        'opened' => '2026-10-01',
        'payment' => 200,
        'everyDays' => 14,
        'payments' => [
            ['id' => 'p1', 'day' => '2026-10-06', 'amount' => 200, 'note' => 'First payment'],
            ['id' => 'p2', 'day' => '2026-10-15', 'amount' => 150, 'note' => ''],
        ],
    ]],
], $again);
assert($status === 200, 'save debts');
[$status, $withDebt] = handleRequest('GET', 'state', null, openDb());
assert($withDebt['debts'][0]['name'] === 'Car loan', 'debt name kept');
assert($withDebt['debts'][0]['payment'] === 200.0, 'planned payment kept');
assert($withDebt['debts'][0]['everyDays'] === 14, 'payment schedule kept');
assert($withDebt['debts'][0]['paid'] === 350.0, 'debt paid sum');
assert($withDebt['debts'][0]['remaining'] === 850.0, 'debt remaining');
assert($withDebt['debts'][0]['payments'][0]['note'] === 'First payment', 'payment note kept');

[$status, $budgetState] = handleRequest('GET', 'state', null, openDb());
assert($status === 200, 'budget state status');
assert($budgetState['budget']['starting'] === 2200.0, 'budget starting seeded');
assert(count(array_filter($budgetState['budget']['items'], fn($item) => empty($item['separate']))) === 8, 'main checklist seeded');
assert($budgetState['budget']['items'][8]['name'] === 'Prime', 'prime side item seeded');
[$status] = handleRequest('PUT', 'budget', [
    'budget' => [
        'title' => 'Budget Note',
        'starting' => 2200,
        'paycheckDate' => '2026-10-15',
        'paycheckLabel' => 'APS-SECURITY COMPANY · Thursday, October 15, 2026',
        'jobId' => 'company',
        'items' => array_map(function ($item, $i) {
            if ($i === 0) {
                $item['paid'] = true;
                $item['name'] = 'Rent';
            }
            return $item;
        }, $budgetState['budget']['items'], array_keys($budgetState['budget']['items'])),
        'history' => [[
            'id' => 'hist-1',
            'paycheckDate' => '2026-10-01',
            'paycheckLabel' => 'APS-SECURITY COMPANY · Thursday, October 1, 2026',
            'jobId' => 'company',
            'starting' => 2200,
            'remaining' => 74,
            'closedAt' => '2026-10-08',
            'items' => $budgetState['budget']['items'],
            'paid' => [['id' => 'pay-1', 'name' => 'Rent', 'amount' => 600, 'separate' => false]],
        ]],
    ],
], openDb());
assert($status === 200, 'save budget');
[$status, $savedBudget] = handleRequest('GET', 'state', null, openDb());
assert($savedBudget['budget']['items'][0]['paid'] === true, 'budget paid kept');
assert($savedBudget['budget']['items'][0]['name'] === 'Rent', 'budget name kept');
assert($savedBudget['budget']['paycheckDate'] === '2026-10-15', 'paycheck date kept');
assert(count($savedBudget['budget']['history']) === 1, 'history kept');
assert($savedBudget['budget']['history'][0]['paid'][0]['amount'] === 600, 'history paid amount kept');

$authDb = openDb();
[$status, $auth] = handleRequest('GET', 'auth/status', null, $authDb, [], false);
assert($status === 200, 'auth status');
assert($auth['lockEnabled'] === false, 'lock off by default');
assert($auth['authenticated'] === true, 'open when unlocked');

[$status, $setup, $cookies] = handleRequest('POST', 'auth/setup', ['pin' => '1357', 'credId' => 'face'], $authDb, [], false);
assert($status === 200, 'setup lock');
assert($setup['lockEnabled'] === true, 'lock enabled');
assert(count($cookies) === 1, 'setup sets cookie');
preg_match('/payday_session=([^;]+)/', $cookies[0], $m);
$session = rawurldecode($m[1] ?? '');
assert($session !== '', 'session token');

[$status, $blocked] = handleRequest('GET', 'state', null, openDb(), [], false);
assert($status === 401, 'state blocked without session');
assert(($blocked['error'] ?? '') === 'locked', 'locked error');

[$status, $ok, $touchCookies] = handleRequest('GET', 'state', null, openDb(), ['payday_session' => $session], false);
assert($status === 200, 'state allowed with session');
assert(count($touchCookies) === 1, 'state refreshes session cookie');
assert(($auth['idleMs'] ?? 0) === 3600000 || ($auth['idleMs'] ?? 0) > 0, 'idleMs reported');

[$status, $touched, $touchSet] = handleRequest('POST', 'auth/touch', null, openDb(), ['payday_session' => $session], false);
assert($status === 200, 'touch ok');
assert(($touched['ok'] ?? false) === true, 'touch success');
assert(count($touchSet) === 1, 'touch sets cookie');

[$status, $badLogin] = handleRequest('POST', 'auth/login', ['pin' => '0000'], openDb(), [], false);
assert($status === 401, 'bad pin rejected');

[$status, $login, $loginCookies] = handleRequest('POST', 'auth/login', ['pin' => '1357'], openDb(), [], false);
assert($status === 200, 'login ok');
preg_match('/payday_session=([^;]+)/', $loginCookies[0] ?? '', $m2);
$loginSession = rawurldecode($m2[1] ?? '');
assert($loginSession !== '', 'login session');

[$status, $disabled, $clear] = handleRequest('POST', 'auth/disable', ['pin' => '1357'], openDb(), ['payday_session' => $loginSession], false);
assert($status === 200, 'disable ok');
assert($disabled['lockEnabled'] === false, 'lock disabled');
[$status, $openAgain] = handleRequest('GET', 'state', null, openDb(), [], false);
assert($status === 200, 'open again after disable');

echo "php api ok\n";
@unlink($file);
