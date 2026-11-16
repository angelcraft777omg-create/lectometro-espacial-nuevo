<?php
/* Configuración del Lectómetro Espacial.
   1. Copia este archivo con el nombre  config.php  (en esta misma carpeta).
   2. Rellena config.php. Ese archivo NO se sube a GitHub (está en .gitignore),
      porque guarda tu clave y los datos de tu base de datos. */
return [

    'bd' => [
        // 'pgsql'  para PostgreSQL (Neon).
        // 'sqlite' para probar en tu ordenador sin instalar nada más.
        // 'mysql'  para MySQL o MariaDB.
        'tipo' => 'sqlite',

        // --- Si tipo es 'pgsql' (Neon) ---
        // Pega aquí la cadena de conexión que da Neon en el botón "Connect",
        // con "Connection pooling" activado (el nombre del servidor lleva -pooler):
        //   'url' => 'postgresql://usuario:clave@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
        'url' => '',

        // --- Si tipo es 'sqlite' ---
        'sqlite_archivo' => __DIR__ . '/datos/lectometro.sqlite',

        // --- Si tipo es 'mysql' (o 'pgsql' sin 'url') ---
        'host'    => 'localhost',
        'puerto'  => 3306,           // 5432 en PostgreSQL
        'nombre'  => 'lectometro',   // nombre de la base de datos
        'usuario' => '',
        'clave'   => '',
    ],

    // La clave con la que entras tú en «Soy el maestro». Cámbiala: con el valor
    // de ejemplo la web no deja entrar. Usa una frase larga, no 4 cifras.
    // (Si prefieres no dejarla escrita tal cual, pega aquí el resultado de
    //  password_hash('tu clave', PASSWORD_DEFAULT) y funcionará igual.)
    'clave_maestro' => 'cambia-esta-clave',
];
