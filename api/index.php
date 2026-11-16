<?php
/* Lectómetro Espacial: API.
   Una sola puerta de entrada: api/index.php?accion=NOMBRE
   - GET  estado            -> quién soy y todos los datos que puedo ver
   - POST entrar            -> un tripulante entra con su código de 4 cifras
   - POST entrar_maestro    -> el maestro entra con su clave
   - POST salir
   - POST (solo maestro)    -> alumnos_crear, alumno_guardar, alumno_codigo, alumno_borrar,
                               libro_guardar, libro_paginas, libro_borrar,
                               reto_guardar, reto_borrar, retos_sugeridos, resena_aceptar
   - POST (maestro o tripulante) -> resena_crear, resena_borrar
   Todas las respuestas son JSON: {"ok":true,...} o {"ok":false,"error":"mensaje"}. */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require __DIR__ . '/bd.php';

const GENEROS = ['aventura', 'miedo', 'misterio', 'accion', 'fantasia', 'ciencia', 'humor', 'comic', 'animales', 'real', 'poesia', 'otro'];
const TIPOS_RETO = ['pages', 'books', 'readers', 'reviews'];
const PALABRAS_MINIMAS = 20;
const MAX_ALUMNOS = 60;
const NUM_COLORES = 10;
const COOKIE = 'lecto_sesion';
const DIAS_SESION = 60;
const MAX_INTENTOS = 10;      // intentos fallidos de entrada...
const VENTANA_INTENTOS = 600; // ...cada 10 minutos por dirección IP

try {
    principal();
} catch (Throwable $e) {
    error_log('Lectómetro: ' . $e->getMessage() . ' en ' . $e->getFile() . ':' . $e->getLine());
    if (bd_en_transaccion()) {
        bd()->rollBack();
    }
    fallo('Ha ocurrido un error en el servidor. Inténtalo de nuevo.', 500);
}

function bd_en_transaccion(): bool
{
    try {
        return bd()->inTransaction();
    } catch (Throwable $e) {
        return false;
    }
}

/* ================= sesiones ================= */

function sesion(): ?array
{
    static $cargada = false, $s = null;
    if ($cargada) {
        return $s;
    }
    $cargada = true;
    $token = (string)($_COOKIE[COOKIE] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }
    // Una sola consulta: la sesión y, si es de un tripulante, si ese tripulante sigue existiendo.
    $fila = una('SELECT s.token, s.rol, s.alumno_id, s.csrf, s.visto, a.id AS alumno_existe
                 FROM sesiones s LEFT JOIN alumnos a ON a.id = s.alumno_id WHERE s.token = ?', [hash('sha256', $token)]);
    if (!$fila || (int)$fila['visto'] < time() - DIAS_SESION * 86400) {
        return null;
    }
    if ($fila['rol'] === 'alumno' && $fila['alumno_existe'] === null) {
        q('DELETE FROM sesiones WHERE token = ?', [$fila['token']]);
        return null;
    }
    if ((int)$fila['visto'] < time() - 3600) {
        q('UPDATE sesiones SET visto = ? WHERE token = ?', [time(), $fila['token']]);
    }
    $s = $fila;
    return $s;
}

function abrir_sesion(string $rol, string $alumno_id): string
{
    $token = bin2hex(random_bytes(32));
    $csrf = bin2hex(random_bytes(16));
    q('INSERT INTO sesiones (token, rol, alumno_id, csrf, creado, visto) VALUES (?, ?, ?, ?, ?, ?)',
        [hash('sha256', $token), $rol, $alumno_id, $csrf, time(), time()]);
    poner_cookie($token, time() + DIAS_SESION * 86400);
    return $csrf;
}

function poner_cookie(string $valor, int $caduca): void
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    setcookie(COOKIE, $valor, ['expires' => $caduca, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $https]);
}

function exigir_sesion(): array
{
    $s = sesion();
    if (!$s) {
        fallo('Tu sesión ha terminado. Vuelve a entrar.', 401);
    }
    $csrf = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!hash_equals((string)$s['csrf'], $csrf)) {
        fallo('La página se ha quedado antigua. Recárgala y vuelve a intentarlo.', 403);
    }
    return $s;
}

function exigir_maestro(): array
{
    $s = exigir_sesion();
    if ($s['rol'] !== 'maestro') {
        fallo('Eso solo puede hacerlo el maestro.', 403);
    }
    return $s;
}

/* Frena a quien prueba códigos o claves al azar. */
function ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'desconocida'), 0, 64);
}

function comprobar_intentos(): void
{
    $f = una('SELECT COUNT(*) AS n FROM intentos WHERE ip = ? AND momento > ?', [ip(), time() - VENTANA_INTENTOS]);
    if ((int)$f['n'] >= MAX_INTENTOS) {
        fallo('Demasiados intentos. Espera unos minutos y vuelve a probar.', 429);
    }
}

function anotar_intento(): void
{
    q('INSERT INTO intentos (id, ip, momento) VALUES (?, ?, ?)', [nuevo_id('i'), ip(), time()]);
    if (random_int(1, 40) === 1) {
        q('DELETE FROM intentos WHERE momento < ?', [time() - 86400]);
        q('DELETE FROM sesiones WHERE visto < ?', [time() - DIAS_SESION * 86400]);
    }
}

/* ================= datos que ve cada uno ================= */

function datos_para(array $s): array
{
    $maestro = $s['rol'] === 'maestro';
    $yo = (string)$s['alumno_id'];

    $alumnos = [];
    $codigos = [];
    foreach (todas('SELECT * FROM alumnos ORDER BY creado, id') as $a) {
        $alumnos[] = ['id' => $a['id'], 'name' => $a['nombre'], 'color' => (int)$a['color'], 'createdAt' => $a['creado']];
        if ($maestro) {
            $codigos[] = ['id' => $a['codigo'], 'studentId' => $a['id']]; // los códigos solo viajan al maestro
        }
    }

    $registro = [];
    if ($maestro) { // el historial de páginas solo lo usa la pestaña Seguimiento
        foreach (todas('SELECT libro_id, fecha, leidas FROM registro ORDER BY fecha, id') as $r) {
            $registro[$r['libro_id']][] = ['d' => $r['fecha'], 'p' => (int)$r['leidas']];
        }
    }
    $libros = [];
    foreach (todas('SELECT * FROM libros ORDER BY creado, id') as $l) {
        $libros[] = [
            'id' => $l['id'], 'studentId' => $l['alumno_id'], 'title' => $l['titulo'], 'author' => $l['autor'], 'genre' => $l['genero'],
            'pages' => (int)$l['paginas'], 'pagesRead' => (int)$l['leidas'], 'createdAt' => $l['creado'], 'updatedAt' => $l['actualizado'],
            'log' => $registro[$l['id']] ?? [],
        ];
    }

    $retos = [];
    foreach (todas('SELECT * FROM retos ORDER BY creado, id') as $r) {
        $retos[] = ['id' => $r['id'], 'title' => $r['titulo'], 'type' => $r['tipo'], 'target' => (int)$r['objetivo'], 'reward' => $r['recompensa'], 'createdAt' => $r['creado']];
    }

    // Un tripulante ve las reseñas aceptadas y las suyas que esperan; el maestro, todas.
    $filas = $maestro
        ? todas('SELECT * FROM resenas ORDER BY creado, id')
        : todas("SELECT * FROM resenas WHERE estado = 'approved' OR alumno_id = ? ORDER BY creado, id", [$yo]);
    $resenas = [];
    foreach ($filas as $r) {
        $resenas[] = [
            'id' => $r['id'], 'studentId' => $r['alumno_id'], 'bookId' => $r['libro_id'], 'title' => $r['titulo'], 'genre' => $r['genero'],
            'pages' => (int)$r['paginas'], 'stars' => (int)$r['estrellas'], 'text' => $r['texto'], 'status' => $r['estado'], 'createdAt' => $r['creado'],
        ];
    }

    return ['students' => $alumnos, 'books' => $libros, 'challenges' => $retos, 'reviews' => $resenas, 'codes' => $codigos];
}

function estado_completo(array $s): array
{
    return [
        'rol' => $s['rol'],
        'yo' => $s['rol'] === 'alumno' ? $s['alumno_id'] : null,
        'csrf' => $s['csrf'],
        'version' => version(),
        'datos' => datos_para($s),
    ];
}

/* ================= piezas reutilizables ================= */

function codigo_libre(): string
{
    do {
        $c = str_pad((string)random_int(1, 9999), 4, '0', STR_PAD_LEFT);
    } while ($c === '1234' || una('SELECT id FROM alumnos WHERE codigo = ?', [$c]));
    return $c;
}

function alumno_o_fallo(string $id): array
{
    $a = una('SELECT * FROM alumnos WHERE id = ?', [$id]);
    if (!$a) {
        fallo('Ese tripulante ya no existe.', 404);
    }
    return $a;
}

function genero_valido($g): string
{
    return in_array($g, GENEROS, true) ? $g : 'otro';
}

/* Apunta un avance de páginas. La fecha lleva milésimas para que dos avances
   del mismo segundo conserven su orden. */
function anotar_registro(string $libro_id, int $leidas, string $fecha = ''): void
{
    $t = microtime(true);
    $fecha = gmdate('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03dZ', (int)(($t - floor($t)) * 1000));
    q('INSERT INTO registro (id, libro_id, fecha, leidas) VALUES (?, ?, ?, ?)', [nuevo_id('g'), $libro_id, $fecha, $leidas]);
}

/* Al aceptar una reseña, su libro queda terminado: se completa el que ya estaba
   apuntado (por id o por el mismo título) o se crea uno nuevo. */
function terminar_libro(string $alumno_id, string $libro_id, string $titulo, string $genero, int $paginas): void
{
    $fecha = ahora();
    $libro = $libro_id !== '' ? una('SELECT * FROM libros WHERE id = ? AND alumno_id = ?', [$libro_id, $alumno_id]) : null;
    if (!$libro) {
        foreach (todas('SELECT * FROM libros WHERE alumno_id = ?', [$alumno_id]) as $l) {
            if (minusculas($l['titulo']) === minusculas($titulo)) {
                $libro = $l;
                break;
            }
        }
    }
    if ($libro) {
        if ((int)$libro['leidas'] < (int)$libro['paginas']) {
            q('UPDATE libros SET leidas = paginas, actualizado = ? WHERE id = ?', [$fecha, $libro['id']]);
            anotar_registro($libro['id'], (int)$libro['paginas'], $fecha);
        }
        return;
    }
    $id = nuevo_id('b');
    q('INSERT INTO libros (id, alumno_id, titulo, autor, genero, paginas, leidas, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$id, $alumno_id, $titulo, '', $genero, $paginas, $paginas, $fecha, $fecha]);
    anotar_registro($id, $paginas, $fecha);
}

function minusculas(string $s): string
{
    $s = trim($s);
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

/* ================= acciones ================= */

function principal(): void
{
    $accion = (string)($_GET['accion'] ?? '');
    $metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    bd(); // conecta y crea las tablas si hace falta

    if ($accion === 'estado') {
        $s = sesion();
        if (!$s) {
            responder(['rol' => null, 'yo' => null]);
        }
        if (isset($_GET['v']) && (int)$_GET['v'] === version()) {
            responder(['sin_cambios' => true]);
        }
        responder(estado_completo($s));
    }

    if ($metodo !== 'POST') {
        fallo('Esta acción necesita una petición POST.', 405);
    }
    $in = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($in)) {
        $in = [];
    }

    switch ($accion) {

        /* ---------- entrar y salir ---------- */

        case 'entrar':
            comprobar_intentos();
            $codigo = (string)($in['codigo'] ?? '');
            $a = preg_match('/^\d{4}$/', $codigo) ? una('SELECT id FROM alumnos WHERE codigo = ?', [$codigo]) : null;
            if (!$a) {
                anotar_intento();
                fallo('Ese código no existe. Compruébalo o pregunta a tu maestro.', 401);
            }
            abrir_sesion('alumno', $a['id']);
            responder();
            break;

        case 'entrar_maestro':
            comprobar_intentos();
            $guardada = (string)(config()['clave_maestro'] ?? '');
            if ($guardada === '' || $guardada === 'cambia-esta-clave') {
                fallo('Antes de entrar, cambia la clave del maestro en api/config.php.', 403);
            }
            $dada = (string)($in['clave'] ?? '');
            $es_hash = strncmp($guardada, '$2y$', 4) === 0 || strncmp($guardada, '$argon2', 7) === 0;
            $bien = $es_hash ? password_verify($dada, $guardada) : hash_equals($guardada, $dada);
            if (!$bien) {
                anotar_intento();
                fallo('La clave no es correcta.', 401);
            }
            abrir_sesion('maestro', '');
            responder();
            break;

        case 'salir':
            $token = (string)($_COOKIE[COOKIE] ?? '');
            if ($token !== '') {
                q('DELETE FROM sesiones WHERE token = ?', [hash('sha256', $token)]);
            }
            poner_cookie('', time() - 3600);
            responder();
            break;

        /* ---------- tripulación (maestro) ---------- */

        case 'alumnos_crear':
            exigir_maestro();
            $nombres = [];
            foreach ((array)($in['nombres'] ?? []) as $n) {
                $n = recortar($n, 40);
                if ($n !== '') {
                    $nombres[] = $n;
                }
            }
            if (!$nombres) {
                fallo('Escribe al menos un nombre.');
            }
            $hay = (int)una('SELECT COUNT(*) AS n FROM alumnos')['n'];
            if ($hay + count($nombres) > MAX_ALUMNOS) {
                fallo('Como máximo caben ' . MAX_ALUMNOS . ' tripulantes.');
            }
            bd()->beginTransaction();
            foreach ($nombres as $i => $n) {
                // la fecha lleva el orden para que la lista salga como se pegó
                q('INSERT INTO alumnos (id, nombre, color, codigo, creado) VALUES (?, ?, ?, ?, ?)',
                    [nuevo_id('s'), $n, ($hay + $i) % NUM_COLORES, codigo_libre(), ahora() . sprintf('%03d', $i)]);
            }
            subir_version();
            bd()->commit();
            responder(['creados' => count($nombres)]);
            break;

        case 'alumno_guardar':
            exigir_maestro();
            $a = alumno_o_fallo((string)($in['id'] ?? ''));
            $nombre = array_key_exists('name', $in) ? recortar($in['name'], 40) : $a['nombre'];
            $color = array_key_exists('color', $in) ? entero($in['color'], 0, NUM_COLORES - 1, 'color') : (int)$a['color'];
            if ($nombre === '') {
                fallo('El nombre no puede quedar vacío.');
            }
            q('UPDATE alumnos SET nombre = ?, color = ? WHERE id = ?', [$nombre, $color, $a['id']]);
            subir_version();
            responder();
            break;

        case 'alumno_codigo':
            exigir_maestro();
            $a = alumno_o_fallo((string)($in['id'] ?? ''));
            $nuevo = codigo_libre();
            q('UPDATE alumnos SET codigo = ? WHERE id = ?', [$nuevo, $a['id']]);
            q("DELETE FROM sesiones WHERE rol = 'alumno' AND alumno_id = ?", [$a['id']]); // quien entró con el código viejo sale
            subir_version();
            responder(['codigo' => $nuevo]);
            break;

        case 'alumno_borrar':
            exigir_maestro();
            $a = alumno_o_fallo((string)($in['id'] ?? ''));
            bd()->beginTransaction();
            foreach (todas('SELECT id FROM libros WHERE alumno_id = ?', [$a['id']]) as $l) {
                q('DELETE FROM registro WHERE libro_id = ?', [$l['id']]);
            }
            q('DELETE FROM libros WHERE alumno_id = ?', [$a['id']]);
            q('DELETE FROM resenas WHERE alumno_id = ?', [$a['id']]);
            q('DELETE FROM sesiones WHERE alumno_id = ?', [$a['id']]);
            q('DELETE FROM alumnos WHERE id = ?', [$a['id']]);
            subir_version();
            bd()->commit();
            responder();
            break;

        /* ---------- lecturas (maestro) ---------- */

        case 'libro_guardar':
            exigir_maestro();
            $a = alumno_o_fallo((string)($in['studentId'] ?? ''));
            $titulo = recortar($in['title'] ?? '', 120);
            if ($titulo === '') {
                fallo('Escribe el título del libro.');
            }
            $autor = recortar($in['author'] ?? '', 80);
            $genero = genero_valido($in['genre'] ?? '');
            $paginas = entero($in['pages'] ?? null, 1, 5000, 'páginas del libro');
            $leidas = entero($in['pagesRead'] ?? 0, 0, $paginas, 'páginas leídas');
            $fecha = ahora();
            $id = (string)($in['id'] ?? '');
            bd()->beginTransaction();
            if ($id !== '') {
                $viejo = una('SELECT * FROM libros WHERE id = ?', [$id]);
                if (!$viejo) {
                    fallo('Ese libro ya no existe.', 404);
                }
                q('UPDATE libros SET alumno_id = ?, titulo = ?, autor = ?, genero = ?, paginas = ?, leidas = ?, actualizado = ? WHERE id = ?',
                    [$a['id'], $titulo, $autor, $genero, $paginas, $leidas, $fecha, $id]);
                if ((int)$viejo['leidas'] !== $leidas) {
                    anotar_registro($id, $leidas, $fecha);
                }
            } else {
                $id = nuevo_id('b');
                q('INSERT INTO libros (id, alumno_id, titulo, autor, genero, paginas, leidas, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$id, $a['id'], $titulo, $autor, $genero, $paginas, $leidas, $fecha, $fecha]);
                anotar_registro($id, $leidas, $fecha);
            }
            subir_version();
            bd()->commit();
            responder(['id' => $id]);
            break;

        case 'libro_paginas':
            exigir_maestro();
            $l = una('SELECT * FROM libros WHERE id = ?', [(string)($in['id'] ?? '')]);
            if (!$l) {
                fallo('Ese libro ya no existe.', 404);
            }
            $leidas = entero($in['pagesRead'] ?? null, 0, (int)$l['paginas'], 'páginas leídas');
            if ($leidas !== (int)$l['leidas']) {
                $fecha = ahora();
                q('UPDATE libros SET leidas = ?, actualizado = ? WHERE id = ?', [$leidas, $fecha, $l['id']]);
                anotar_registro($l['id'], $leidas, $fecha);
                subir_version();
            }
            responder();
            break;

        case 'libro_borrar':
            exigir_maestro();
            $id = (string)($in['id'] ?? '');
            q('DELETE FROM registro WHERE libro_id = ?', [$id]);
            q('DELETE FROM libros WHERE id = ?', [$id]);
            subir_version();
            responder();
            break;

        /* ---------- retos de grupo (maestro) ---------- */

        case 'reto_guardar':
            exigir_maestro();
            $titulo = recortar($in['title'] ?? '', 80);
            if ($titulo === '') {
                fallo('Ponle un nombre al reto.');
            }
            $tipo = in_array($in['type'] ?? '', TIPOS_RETO, true) ? $in['type'] : 'pages';
            $objetivo = entero($in['target'] ?? null, 1, 1000000, 'objetivo');
            $recompensa = recortar($in['reward'] ?? '', 120);
            $id = (string)($in['id'] ?? '');
            if ($id !== '') {
                if (!una('SELECT id FROM retos WHERE id = ?', [$id])) {
                    fallo('Ese reto ya no existe.', 404);
                }
                q('UPDATE retos SET titulo = ?, tipo = ?, objetivo = ?, recompensa = ? WHERE id = ?', [$titulo, $tipo, $objetivo, $recompensa, $id]);
            } else {
                q('INSERT INTO retos (id, titulo, tipo, objetivo, recompensa, creado) VALUES (?, ?, ?, ?, ?, ?)',
                    [nuevo_id('c'), $titulo, $tipo, $objetivo, $recompensa, ahora()]);
            }
            subir_version();
            responder();
            break;

        case 'reto_borrar':
            exigir_maestro();
            q('DELETE FROM retos WHERE id = ?', [(string)($in['id'] ?? '')]);
            subir_version();
            responder();
            break;

        case 'retos_sugeridos':
            exigir_maestro();
            $n = max(1, (int)una('SELECT COUNT(*) AS n FROM alumnos')['n']);
            $sugeridos = [
                ['Toda la tripulación a bordo', 'readers', $n],
                ['5000 páginas entre todos', 'pages', 5000],
                [($n * 2) . ' libros terminados', 'books', $n * 2],
                ['Una reseña por tripulante', 'reviews', $n],
            ];
            bd()->beginTransaction();
            foreach ($sugeridos as $i => $r) {
                q('INSERT INTO retos (id, titulo, tipo, objetivo, recompensa, creado) VALUES (?, ?, ?, ?, ?, ?)',
                    [nuevo_id('c'), $r[0], $r[1], $r[2], '', ahora() . sprintf('%03d', $i)]);
            }
            subir_version();
            bd()->commit();
            responder();
            break;

        /* ---------- reseñas ---------- */

        case 'resena_crear':
            $s = exigir_sesion();
            $maestro = $s['rol'] === 'maestro';
            // un tripulante solo puede escribir en su propio nombre
            $a = alumno_o_fallo($maestro ? (string)($in['studentId'] ?? '') : (string)$s['alumno_id']);
            $titulo = recortar($in['title'] ?? '', 120);
            if ($titulo === '') {
                fallo('Escribe el título del libro.');
            }
            $genero = genero_valido($in['genre'] ?? '');
            $paginas = entero($in['pages'] ?? null, 1, 5000, 'número de páginas');
            $estrellas = entero($in['stars'] ?? null, 1, 5, 'estrellas');
            $texto = texto_largo($in['text'] ?? '', 2000);
            $palabras = count(preg_split('/\s+/u', $texto, -1, PREG_SPLIT_NO_EMPTY));
            if ($palabras < PALABRAS_MINIMAS) {
                fallo('La reseña necesita al menos ' . PALABRAS_MINIMAS . ' palabras.');
            }
            $libro_id = (string)($in['bookId'] ?? '');
            if ($libro_id !== '' && !una('SELECT id FROM libros WHERE id = ? AND alumno_id = ?', [$libro_id, $a['id']])) {
                $libro_id = '';
            }
            if (!$maestro) {
                $esperando = (int)una("SELECT COUNT(*) AS n FROM resenas WHERE alumno_id = ? AND estado = 'pending'", [$a['id']])['n'];
                if ($esperando >= 5) {
                    fallo('Ya tienes varias reseñas esperando. Espera a que tu maestro las revise.');
                }
            }
            bd()->beginTransaction();
            $estado = $maestro ? 'approved' : 'pending'; // las del alumnado esperan al maestro
            q('INSERT INTO resenas (id, alumno_id, libro_id, titulo, genero, paginas, estrellas, texto, estado, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [nuevo_id('r'), $a['id'], $libro_id, $titulo, $genero, $paginas, $estrellas, $texto, $estado, ahora()]);
            if ($maestro) {
                terminar_libro($a['id'], $libro_id, $titulo, $genero, $paginas);
            }
            subir_version();
            bd()->commit();
            responder(['estado' => $estado]);
            break;

        case 'resena_aceptar':
            exigir_maestro();
            $r = una('SELECT * FROM resenas WHERE id = ?', [(string)($in['id'] ?? '')]);
            if (!$r) {
                fallo('Esa reseña ya no existe.', 404);
            }
            if ($r['estado'] !== 'approved') {
                bd()->beginTransaction();
                q("UPDATE resenas SET estado = 'approved' WHERE id = ?", [$r['id']]);
                terminar_libro($r['alumno_id'], (string)$r['libro_id'], $r['titulo'], $r['genero'], (int)$r['paginas']);
                subir_version();
                bd()->commit();
            }
            responder();
            break;

        case 'resena_borrar':
            $s = exigir_sesion();
            $r = una('SELECT * FROM resenas WHERE id = ?', [(string)($in['id'] ?? '')]);
            if (!$r) {
                responder();
            }
            // un tripulante solo puede retirar una reseña suya que todavía espera
            if ($s['rol'] !== 'maestro' && !($r['alumno_id'] === $s['alumno_id'] && $r['estado'] === 'pending')) {
                fallo('Esa reseña solo puede borrarla el maestro.', 403);
            }
            q('DELETE FROM resenas WHERE id = ?', [$r['id']]);
            subir_version();
            responder();
            break;

        default:
            fallo('Acción desconocida.', 404);
    }
}
