/** Esquema de la base de datos local.
 *
 *  Es una base SQLite embebida en el dispositivo: todo lo que la aplicación
 *  necesita durante un recorrido vive acá, sin servidor y sin conexión.
 *
 *  Las migraciones se aplican en orden y de forma acumulativa. `user_version`
 *  de SQLite guarda cuál fue la última aplicada, de modo que actualizar la
 *  aplicación no obliga a borrar los senderos ya descargados.
 */

export const VERSION_ESQUEMA = 1;

export const MIGRACIONES: string[] = [
  // v1 — esquema inicial
  `
  CREATE TABLE IF NOT EXISTS senderos (
    id               TEXT PRIMARY KEY,
    nombre           TEXT NOT NULL,
    descripcion      TEXT,
    distancia_m      REAL NOT NULL,
    desnivel_m       REAL NOT NULL,
    indice_esfuerzo  REAL NOT NULL,
    exigencia        TEXT NOT NULL CHECK (exigencia IN ('principiante','intermedio','avanzado')),
    estado           TEXT NOT NULL DEFAULT 'pendiente_revision'
                          CHECK (estado IN ('publicado','pendiente_revision')),
    origen           TEXT NOT NULL CHECK (origen IN ('precargado','importado')),
    descargado_en    TEXT,
    creado_en        TEXT NOT NULL
  );

  -- Los puntos van en su propia tabla y no como JSON dentro del sendero:
  -- el cálculo de distancia a la traza los recorre en cada lectura del GPS.
  CREATE TABLE IF NOT EXISTS puntos (
    sendero_id  TEXT NOT NULL REFERENCES senderos(id) ON DELETE CASCADE,
    orden       INTEGER NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    ele         REAL,
    tiempo      TEXT,
    PRIMARY KEY (sendero_id, orden)
  );

  -- Perfil del caminante. Una única fila: el CHECK lo garantiza.
  CREATE TABLE IF NOT EXISTS perfil (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    nivel  TEXT NOT NULL CHECK (nivel IN ('principiante','intermedio','avanzado')),
    actualizado_en TEXT NOT NULL
  );

  -- Reportes de estado del camino generados durante la caminata.
  CREATE TABLE IF NOT EXISTS reportes (
    id               TEXT PRIMARY KEY,
    sendero_id       TEXT NOT NULL REFERENCES senderos(id) ON DELETE CASCADE,
    tipo             TEXT NOT NULL,
    comentario       TEXT,
    lat              REAL,
    lon              REAL,
    creado_en        TEXT NOT NULL,
    sincronizado_en  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reportes_sendero ON reportes(sendero_id);

  -- Cola de sincronización. La restricción UNIQUE es lo que evita que un
  -- mismo reporte se envíe dos veces si la sincronización se interrumpe.
  CREATE TABLE IF NOT EXISTS cola_sincronizacion (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entidad     TEXT NOT NULL,
    entidad_id  TEXT NOT NULL,
    operacion   TEXT NOT NULL,
    intentos    INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    creado_en   TEXT NOT NULL,
    UNIQUE (entidad, entidad_id, operacion)
  );

  -- Pronóstico guardado junto al sendero, para poder mostrar la advertencia
  -- cuando ya no hay conexión, indicando cuándo se obtuvo.
  CREATE TABLE IF NOT EXISTS pronosticos (
    sendero_id        TEXT NOT NULL REFERENCES senderos(id) ON DELETE CASCADE,
    fecha             TEXT NOT NULL,
    precipitacion_mm  REAL NOT NULL,
    viento_kmh        REAL NOT NULL,
    temp_min_c        REAL NOT NULL,
    temp_max_c        REAL NOT NULL,
    obtenido_en       TEXT NOT NULL,
    PRIMARY KEY (sendero_id, fecha)
  );

  -- Trazabilidad: qué advirtió el sistema, cuándo y qué decidió la persona.
  -- En un sistema cuyo objeto es la seguridad, esto no es un accesorio.
  CREATE TABLE IF NOT EXISTS alertas_emitidas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sendero_id  TEXT REFERENCES senderos(id) ON DELETE SET NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('desvio','clima','nivel')),
    detalle     TEXT,
    aceptada    INTEGER,
    emitida_en  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alertas_sendero ON alertas_emitidas(sendero_id);
  `,
];
