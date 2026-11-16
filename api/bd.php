<?php
/* Lectómetro Espacial: conexión con la base de datos y utilidades comunes.
   Funciona con PostgreSQL (por ejemplo Neon), con MySQL/MariaDB y con SQLite (pruebas en tu ordenador). */
declare(strict_types=1);

function config(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $archivo = __DIR__ . '/config.php';
    if (!is_file($archivo)) {
        fallo('Falta el archivo api/config.php. Copia api/config.ejemplo.php con ese nombre y rellénalo.', 500);
    }
    $c = require $archivo;
    if (!is_array($c)) {
        fallo('El archivo api/config.php no devuelve la configuración.', 500);
    }
    return $c;
}

function bd(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c = config()['bd'] ?? [];
    $tipo = (string)($c['tipo'] ?? 'mysql');
    if ($tipo === 'postgres' || $tipo === 'postgresql' || $tipo === 'neon') {
        $tipo = 'pgsql';
    }
    if (!in_array($tipo, ['pgsql', 'mysql', 'sqlite'], true)) {
        fallo("En api/config.php, 'tipo' debe ser 'pgsql', 'mysql' o 'sqlite'.", 500);
    }
    if (!in_array($tipo, PDO::getAvailableDrivers(), true)) {
        fallo('Este servidor no tiene activada la extensión de PHP pdo_' . $tipo . '. Actívala en el panel del alojamiento o pídesela a su soporte.', 500);
    }
    try {
        if ($tipo === 'pgsql') {
            $pdo = conectar_postgres($c);
        } elseif ($tipo === 'sqlite') {
            $ruta = (string)($c['sqlite_archivo'] ?? (__DIR__ . '/datos/lectometro.sqlite'));
            if (!is_dir(dirname($ruta))) {
                mkdir(dirname($ruta), 0775, true);
            }
            $pdo = new PDO('sqlite:' . $ruta);
            $pdo->exec('PRAGMA busy_timeout = 4000');
        } else {
            $dsn = 'mysql:host=' . ($c['host'] ?? 'localhost') . ';port=' . (int)($c['puerto'] ?? 3306)
                . ';dbname=' . ($c['nombre'] ?? '') . ';charset=utf8mb4';
            $pdo = new PDO($dsn, (string)($c['usuario'] ?? ''), (string)($c['clave'] ?? ''), [
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        }
    } catch (PDOException $e) {
        error_log('Lectómetro: ' . $e->getMessage());
        fallo('No se puede conectar con la base de datos. Revisa los datos de api/config.php.', 500);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    preparar_tablas($pdo, $tipo);
    return $pdo;
}

/* PostgreSQL (Neon). Lo más cómodo es pegar en 'url' la cadena de conexión que da Neon:
   postgresql://usuario:clave@ep-xxxx-pooler.region.aws.neon.tech/basededatos?sslmode=require
   También valen los campos sueltos host, puerto, nombre, usuario y clave. */
function conectar_postgres(array $c): PDO
{
    $extra = [];
    if (!empty($c['url'])) {
        $u = parse_url((string)$c['url']);
        if (!$u || empty($u['host'])) {
            fallo("La 'url' de api/config.php no parece una cadena de conexión de PostgreSQL.", 500);
        }
        parse_str($u['query'] ?? '', $extra);
        $c = [
            'host' => $u['host'],
            'puerto' => $u['port'] ?? 5432,
            'nombre' => ltrim(rawurldecode($u['path'] ?? ''), '/'),
            'usuario' => rawurldecode($u['user'] ?? ''),
            'clave' => rawurldecode($u['pass'] ?? ''),
        ];
    }
    $host = (string)($c['host'] ?? 'localhost');
    $base = 'pgsql:host=' . $host . ';port=' . (int)($c['puerto'] ?? 5432) . ';dbname=' . ($c['nombre'] ?? '');
    // Neon exige conexión cifrada: si no se dice otra cosa, se pide siempre.
    $ssl = (string)($extra['sslmode'] ?? $c['sslmode'] ?? 'require');
    $opciones = [
        // Sin sentencias preparadas en el servidor: así funciona también con la conexión
        // agrupada de Neon (la que lleva -pooler en el nombre), que es la recomendada.
        PDO::ATTR_EMULATE_PREPARES => true,
        PDO::ATTR_TIMEOUT => 15,
    ];
    $abrir = function (string $dsn) use ($c, $opciones) {
        return new PDO($dsn, (string)($c['usuario'] ?? ''), (string)($c['clave'] ?? ''), $opciones);
    };
    $dsn = $base . ';sslmode=' . $ssl;
    $ligadura = isset($extra['channel_binding']) ? ';channel_binding=' . preg_replace('/[^a-z]/', '', (string)$extra['channel_binding']) : '';
    try {
        return $abrir($dsn . $ligadura);
    } catch (PDOException $e) {
        $m = $e->getMessage();
        if ($ligadura !== '' && stripos($m, 'channel_binding') !== false) {
            // Servidores con una librería de PostgreSQL antigua no conocen esta opción.
            return $abrir($dsn);
        }
        if (stripos($m, 'ndpoint ID is not specified') !== false) {
            // Librerías antiguas sin SNI: Neon pide que se le diga el identificador del servidor.
            $id = preg_replace('/-pooler$/', '', explode('.', $host)[0]);
            return $abrir($dsn . ";options='endpoint=" . $id . "'");
        }
        throw $e;
    }
}

/* Crea las tablas la primera vez. El mismo esquema está en la carpeta database/
   por si prefieres crearlo a mano. */
function preparar_tablas(PDO $pdo, string $tipo): void
{
    try {
        $f = $pdo->query("SELECT valor FROM ajustes WHERE clave = 'version'")->fetch();
        if ($f) {
            $GLOBALS['lecto_version'] = (int)$f['valor']; // se aprovecha el viaje: ya sabemos la versión
            return;
        }
    } catch (PDOException $e) {
        // Las tablas todavía no existen: se crean ahora.
    }
    $fin = $tipo === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $tablas = [
        'CREATE TABLE IF NOT EXISTS alumnos (
            id VARCHAR(24) NOT NULL PRIMARY KEY,
            nombre VARCHAR(60) NOT NULL,
            color INT NOT NULL DEFAULT 0,
            codigo CHAR(4) NOT NULL UNIQUE,
            creado VARCHAR(25) NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS libros (
            id VARCHAR(24) NOT NULL PRIMARY KEY,
            alumno_id VARCHAR(24) NOT NULL,
            titulo VARCHAR(160) NOT NULL,
            autor VARCHAR(120) NOT NULL DEFAULT \'\',
            genero VARCHAR(20) NOT NULL,
            paginas INT NOT NULL,
            leidas INT NOT NULL DEFAULT 0,
            creado VARCHAR(25) NOT NULL,
            actualizado VARCHAR(25) NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS registro (
            id VARCHAR(24) NOT NULL PRIMARY KEY,
            libro_id VARCHAR(24) NOT NULL,
            fecha VARCHAR(25) NOT NULL,
            leidas INT NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS retos (
            id VARCHAR(24) NOT NULL PRIMARY KEY,
            titulo VARCHAR(120) NOT NULL,
            tipo VARCHAR(20) NOT NULL,
            objetivo INT NOT NULL,
            recompensa VARCHAR(200) NOT NULL DEFAULT \'\',
            creado VARCHAR(25) NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS resenas (
            id VARCHAR(24) NOT NULL PRIMARY KEY,
            alumno_id VARCHAR(24) NOT NULL,
            libro_id VARCHAR(24) NOT NULL DEFAULT \'\',
            titulo VARCHAR(160) NOT NULL,
            genero VARCHAR(20) NOT NULL,
            paginas INT NOT NULL,
            estrellas INT NOT NULL,
            texto TEXT NOT NULL,
            estado VARCHAR(10) NOT NULL,
            creado VARCHAR(25) NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS sesiones (
            token CHAR(64) NOT NULL PRIMARY KEY,
            rol VARCHAR(10) NOT NULL,
            alumno_id VARCHAR(24) NOT NULL DEFAULT \'\',
            csrf CHAR(32) NOT NULL,
            creado INT NOT NULL,
            visto INT NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS intentos (
            id VARCHAR(24) NOT NULL PRIMARY KEY,
            ip VARCHAR(64) NOT NULL,
            momento INT NOT NULL
        )',
        'CREATE TABLE IF NOT EXISTS ajustes (
            clave VARCHAR(40) NOT NULL PRIMARY KEY,
            valor INT NOT NULL
        )',
    ];
    foreach ($tablas as $sql) {
        $pdo->exec($sql . $fin);
    }
    $hay = $pdo->query("SELECT COUNT(*) AS n FROM ajustes WHERE clave = 'version'")->fetch();
    if ((int)$hay['n'] === 0) {
        $pdo->exec("INSERT INTO ajustes (clave, valor) VALUES ('version', 1)");
    }
}

/* ---------- consultas ---------- */

function q(string $sql, array $params = []): PDOStatement
{
    $st = bd()->prepare($sql);
    $st->execute($params);
    return $st;
}

function una(string $sql, array $params = []): ?array
{
    $fila = q($sql, $params)->fetch();
    return $fila === false ? null : $fila;
}

function todas(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function nuevo_id(string $prefijo): string
{
    return $prefijo . bin2hex(random_bytes(8));
}

function ahora(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

/* Cada cambio sube la versión: así las pantallas abiertas saben que deben refrescarse. */
function subir_version(): void
{
    q("UPDATE ajustes SET valor = valor + 1 WHERE clave = 'version'");
    unset($GLOBALS['lecto_version']);
}

function version(): int
{
    if (!isset($GLOBALS['lecto_version'])) {
        $f = una("SELECT valor FROM ajustes WHERE clave = 'version'");
        $GLOBALS['lecto_version'] = $f ? (int)$f['valor'] : 0;
    }
    return $GLOBALS['lecto_version'];
}

/* ---------- respuestas ---------- */

function responder(array $datos = [], int $codigo = 200): void
{
    http_response_code($codigo);
    echo json_encode(['ok' => true] + $datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fallo(string $mensaje, int $codigo = 400): void
{
    http_response_code($codigo);
    echo json_encode(['ok' => false, 'error' => $mensaje], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* ---------- limpieza de lo que llega del navegador ---------- */

function recortar($valor, int $max): string
{
    $s = is_string($valor) || is_numeric($valor) ? (string)$valor : '';
    $s = trim((string)preg_replace('/\s+/u', ' ', $s));
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

function texto_largo($valor, int $max): string
{
    $s = is_string($valor) ? trim($valor) : '';
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

function entero($valor, int $min, int $max, string $nombre): int
{
    if (!is_numeric($valor)) {
        fallo('Falta un número en «' . $nombre . '».');
    }
    $n = (int)round((float)$valor);
    if ($n < $min || $n > $max) {
        fallo('El valor de «' . $nombre . '» debe estar entre ' . $min . ' y ' . $max . '.');
    }
    return $n;
}
