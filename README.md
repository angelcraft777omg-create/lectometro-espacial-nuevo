# Lectómetro Espacial

Web para registrar la lectura de una clase de 5.º de Primaria: mapa espacial con la nave de cada tripulante, cuaderno de lecturas, retos de grupo, reseñas que el maestro acepta y una pestaña de seguimiento.

- **Front:** HTML, CSS y JavaScript, sin compilación.
- **Servidor:** PHP (7.4 o superior) con PDO.
- **Base de datos:** PostgreSQL en **Neon** (o MySQL/MariaDB si lo prefieres); SQLite para probar en tu ordenador sin instalar nada más.

## Qué hay en la carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `css/styles.css` | La página y su diseño. |
| `js/app.js` | La lógica del navegador: pinta la web y habla con el servidor. |
| `api/index.php` | **La API**: todas las acciones (entrar, tripulación, libros, retos, reseñas). |
| `api/bd.php` | Conexión con la base de datos, creación de tablas y utilidades. |
| `api/config.ejemplo.php` | Plantilla de configuración. Se copia como `api/config.php`. |
| `api/.htaccess`, `api/datos/` | Protección de archivos y carpeta de la base de datos de pruebas. |
| `database/esquema-postgres.sql` | Las tablas para Neon (PostgreSQL), por si quieres verlas o crearlas a mano. |
| `database/esquema-mysql.sql` | Lo mismo para MySQL o MariaDB. |

## Cómo funciona

El navegador nunca toca la base de datos: llama a `api/index.php?accion=...` y el servidor decide qué puede hacer cada uno.

- **Tú** entras con tu clave de maestro (la que pones en `api/config.php`).
- **Cada tripulante** entra con su código de 4 cifras, que el servidor genera al añadirlo.
- **Se actualiza solo:** cada 8 segundos la web pregunta al servidor si algo ha cambiado. Si otro dispositivo registra un libro o envía una reseña, lo ves sin recargar. El intervalo es `REFRESCO`, al principio de `js/app.js`.

| Acción | Quién | Qué hace |
|---|---|---|
| `estado` (GET) | cualquiera | Dice quién eres y devuelve los datos que puedes ver. |
| `entrar`, `entrar_maestro`, `salir` | cualquiera | Abrir y cerrar sesión. |
| `alumnos_crear`, `alumno_guardar`, `alumno_codigo`, `alumno_borrar` | maestro | Gestionar la tripulación y sus códigos. |
| `libro_guardar`, `libro_paginas`, `libro_borrar` | maestro | Registrar libros y actualizar páginas. |
| `reto_guardar`, `reto_borrar`, `retos_sugeridos` | maestro | Retos de grupo. |
| `resena_crear` | maestro o tripulante | Las del alumnado quedan pendientes. |
| `resena_aceptar` | maestro | Publica la reseña y deja su libro como terminado. |
| `resena_borrar` | maestro, o el tripulante si es suya y aún espera | Rechazar o retirar. |

## 1. Probarlo en tu ordenador

Necesitas tener PHP instalado (`php -v` en la terminal debe responder). Con XAMPP o similar también vale.

1. Abre la carpeta en VS Code.
2. Copia `api/config.ejemplo.php` como `api/config.php`.
3. En `api/config.php`, cambia `clave_maestro` por tu clave. Deja `'tipo' => 'sqlite'`.
4. En la terminal de VS Code, dentro de la carpeta del proyecto:

   ```bash
   php -S localhost:8000
   ```

5. Abre <http://localhost:8000>. Pulsa **Soy el maestro** y entra con tu clave.

Las tablas se crean solas la primera vez. La extensión Live Server no sirve aquí, porque no ejecuta PHP.

## 2. Subirlo a GitHub

```bash
git init
git add .
git commit -m "Lectómetro Espacial"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/lectometro-espacial.git
git push -u origin main
```

`api/config.php` y la base de datos de pruebas están en `.gitignore`: no se suben. Así tu clave y los datos del alumnado nunca llegan a GitHub.

**GitHub Pages no sirve para esta versión**, porque no ejecuta PHP. GitHub guarda el código; para publicarla necesitas un alojamiento con PHP (paso 4).

## 3. La base de datos en Neon

Neon aloja la base de datos (PostgreSQL). El PHP sigue necesitando su propio alojamiento: mira el paso 4.

1. Crea una cuenta en <https://neon.com> y un **proyecto**. Elige una región europea.
2. En el panel del proyecto, pulsa **Connect**. Deja activado **Connection pooling** (el nombre del servidor lleva `-pooler`) y copia la cadena de conexión. Tiene esta forma:

   ```text
   postgresql://usuario:clave@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

3. En `api/config.php` pon:

   ```php
   'tipo' => 'pgsql',
   'url'  => 'la cadena que has copiado',
   ```

4. Abre la web. **Las tablas se crean solas** en la primera visita. Si prefieres crearlas tú, pega `database/esquema-postgres.sql` en el **SQL Editor** de Neon y ejecútalo.

Puedes hacer esto ya desde tu ordenador (`php -S localhost:8000`): la web local trabajará contra la base de datos de Neon.

Cosas que conviene saber de Neon:

- **La cadena de conexión lleva la contraseña.** Va solo en `api/config.php`, que no se sube a GitHub. Si alguna vez se te escapa, cambia la contraseña del usuario en el panel de Neon y actualiza `api/config.php`.
- **En el plan gratuito la base de datos se duerme** tras unos minutos sin uso. La primera visita después tarda un poco más en cargar; es normal.
- **Mientras haya una pestaña abierta, la base de datos sigue despierta**, porque la web pregunta cada 8 segundos. Eso gasta horas de cómputo del plan gratuito. Para una clase sobra, pero no dejes la web abierta todo el día en una pantalla. Si quieres gastar menos, sube `REFRESCO` en `js/app.js` (por ejemplo a `20000`).
- **Copias de seguridad:** Neon permite restaurar la base de datos a un momento reciente; cuánto historial guarda depende del plan. Para tener una copia tuya, usa `pg_dump` con la cadena de conexión directa (sin `-pooler`).

## 4. Publicar la web (el PHP)

Sirve cualquier alojamiento que cumpla esto:

- **PHP 7.4 o superior** con la extensión **`pdo_pgsql`** activada. No todos los alojamientos compartidos la traen: compruébalo antes de contratar.
- Que permita **conexiones salientes al puerto 5432** (el de PostgreSQL). Algunos alojamientos gratuitos las bloquean.
- **HTTPS.** Sin él, los códigos y tu clave viajarían sin cifrar.

Pasos:

1. **Sube todos los archivos** a la carpeta pública (por FTP, o con el despliegue desde Git si tu alojamiento lo ofrece).
2. En el servidor, **crea `api/config.php`** con `'tipo' => 'pgsql'`, la `url` de Neon y tu `clave_maestro`.
3. Abre la web y entra como maestro.

Si tu alojamiento solo ofrece MySQL, también vale: crea allí la base de datos y pon `'tipo' => 'mysql'` con sus datos en lugar de la `url`.

## 5. Primer uso

1. **Soy el maestro** y entra con tu clave.
2. En **Tripulación**, pega la lista de clase. Cada tripulante recibe su código; con **Copiar lista de códigos** te la llevas para repartirla.
3. En **Retos de grupo**, crea los retos. El botón de retos sugeridos los ajusta al número de tripulantes.
4. Da la dirección de la web a las familias y su código a cada niño.

## Seguridad y privacidad

Son datos de menores, así que conviene saber qué hace el servidor:

- **Sin entrar no se ve nada.** La API solo devuelve datos a quien tiene una sesión abierta.
- **Los permisos se comprueban en el servidor**, no en el navegador. Un tripulante no puede registrar libros, tocar a otros tripulantes ni aceptar reseñas, aunque manipule la página. Solo puede enviar reseñas en su propio nombre, y quedan pendientes.
- **Los códigos solo viajan al maestro.** Un tripulante no recibe los códigos de los demás.
- **Límite de intentos:** tras 10 códigos o claves erróneos en 10 minutos desde la misma conexión, el servidor bloquea más intentos durante un rato. Ojo: en un aula todos comparten conexión, así que varios niños fallando a la vez pueden activarlo. Se ajusta con `MAX_INTENTOS` en `api/index.php`.
- **Cambiar un código** cierra la sesión de quien entró con el anterior.
- **Las sesiones** duran 60 días sin uso y se guardan en una cookie que el JavaScript no puede leer.

Lo que no cubre:

- Un código de 4 cifras sirve para organizar una clase, no como contraseña. Quien tenga el código de un compañero ve lo mismo que él y puede enviar una reseña pendiente en su nombre. Tú la puedes rechazar.
- Dentro de la clase, cada tripulante ve los nombres, libros y reseñas aceptadas de los demás. Usa nombre de pila o iniciales.

Antes de usarla con la clase, coméntalo con la dirección del centro o su responsable de protección de datos.

## Copia de seguridad

En Neon, mira el apartado de copias del paso 3. Con MySQL, usa **Exportar** en phpMyAdmin de vez en cuando.

## Problemas frecuentes

- **«Falta el archivo api/config.php»:** no has copiado la plantilla (en tu ordenador o en el servidor).
- **«No se puede conectar con la base de datos»:** revisa la `url` de Neon en `api/config.php` (cópiala entera, con `?sslmode=require`). Si es correcta, puede que tu alojamiento bloquee el puerto 5432.
- **«Este servidor no tiene activada la extensión de PHP pdo_pgsql»:** actívala en el panel del alojamiento o pídesela a su soporte.
- **La primera carga tarda unos segundos:** la base de datos de Neon estaba dormida.
- **«Antes de entrar, cambia la clave del maestro»:** `clave_maestro` sigue con el valor de ejemplo.
- **«El servidor no ha respondido bien»:** la carpeta `api/` no está subida, el alojamiento no tiene PHP, o estás abriendo `index.html` como archivo en vez de a través de un servidor.
- **«Demasiados intentos»:** espera diez minutos, o vacía la tabla `intentos`.
- **Un tripulante ha olvidado su código:** lo ves en *Tripulación*, o pulsa **Nuevo código**.
- **He olvidado mi clave:** cámbiala en `api/config.php`.

## Personalizar

- `js/app.js`, al principio: `BONUS` (puntos por libro terminado), `MIN_WORDS` (palabras mínimas de una reseña), `STATIONS` (paradas del mapa), `GENRES` (tipos de libro), `REFRESCO` (cada cuánto se actualiza).
- `api/index.php`, al principio: `PALABRAS_MINIMAS` y `GENEROS` deben coincidir con los de `js/app.js`; `MAX_ALUMNOS`, `DIAS_SESION`, `MAX_INTENTOS`.
