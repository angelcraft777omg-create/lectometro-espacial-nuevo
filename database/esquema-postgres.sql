-- Lectómetro Espacial: esquema para PostgreSQL (Neon).
-- No hace falta importarlo: la web crea estas tablas sola la primera vez que se abre.
-- Está aquí por si prefieres crearlas a mano (en Neon: SQL Editor, pegar y ejecutar) o quieres consultarlas.

CREATE TABLE IF NOT EXISTS alumnos (
  id        VARCHAR(24)  NOT NULL PRIMARY KEY,
  nombre    VARCHAR(60)  NOT NULL,
  color     INT          NOT NULL DEFAULT 0,      -- color de la nave (0-9)
  codigo    CHAR(4)      NOT NULL UNIQUE,         -- código de acceso del tripulante
  creado    VARCHAR(25)  NOT NULL
);

CREATE TABLE IF NOT EXISTS libros (
  id          VARCHAR(24)  NOT NULL PRIMARY KEY,
  alumno_id   VARCHAR(24)  NOT NULL,
  titulo      VARCHAR(160) NOT NULL,
  autor       VARCHAR(120) NOT NULL DEFAULT '',
  genero      VARCHAR(20)  NOT NULL,
  paginas     INT          NOT NULL,
  leidas      INT          NOT NULL DEFAULT 0,    -- páginas leídas hasta ahora
  creado      VARCHAR(25)  NOT NULL,
  actualizado VARCHAR(25)  NOT NULL
);

-- Historial de páginas de cada libro (para la gráfica semanal y la inactividad).
CREATE TABLE IF NOT EXISTS registro (
  id        VARCHAR(24) NOT NULL PRIMARY KEY,
  libro_id  VARCHAR(24) NOT NULL,
  fecha     VARCHAR(25) NOT NULL,
  leidas    INT         NOT NULL
);

CREATE TABLE IF NOT EXISTS retos (
  id         VARCHAR(24)  NOT NULL PRIMARY KEY,
  titulo     VARCHAR(120) NOT NULL,
  tipo       VARCHAR(20)  NOT NULL,               -- pages | books | readers | reviews
  objetivo   INT          NOT NULL,
  recompensa VARCHAR(200) NOT NULL DEFAULT '',
  creado     VARCHAR(25)  NOT NULL
);

CREATE TABLE IF NOT EXISTS resenas (
  id        VARCHAR(24)  NOT NULL PRIMARY KEY,
  alumno_id VARCHAR(24)  NOT NULL,
  libro_id  VARCHAR(24)  NOT NULL DEFAULT '',
  titulo    VARCHAR(160) NOT NULL,
  genero    VARCHAR(20)  NOT NULL,
  paginas   INT          NOT NULL,
  estrellas INT          NOT NULL,
  texto     TEXT         NOT NULL,
  estado    VARCHAR(10)  NOT NULL,                -- pending (espera al maestro) | approved
  creado    VARCHAR(25)  NOT NULL
);

-- Sesiones abiertas (quién ha entrado desde cada dispositivo).
CREATE TABLE IF NOT EXISTS sesiones (
  token     CHAR(64)    NOT NULL PRIMARY KEY,
  rol       VARCHAR(10) NOT NULL,                 -- maestro | alumno
  alumno_id VARCHAR(24) NOT NULL DEFAULT '',
  csrf      CHAR(32)    NOT NULL,
  creado    INT         NOT NULL,
  visto     INT         NOT NULL
);

-- Intentos fallidos de entrada, para frenar a quien prueba códigos al azar.
CREATE TABLE IF NOT EXISTS intentos (
  id      VARCHAR(24) NOT NULL PRIMARY KEY,
  ip      VARCHAR(64) NOT NULL,
  momento INT         NOT NULL
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave VARCHAR(40) NOT NULL PRIMARY KEY,
  valor INT         NOT NULL
);

INSERT INTO ajustes (clave, valor) VALUES ('version', 1) ON CONFLICT (clave) DO NOTHING;
