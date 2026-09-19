/** Acceso a la base SQLite local y repositorios del dominio.
 *
 *  Toda la aplicación trabaja contra esta base: es el corazón de la
 *  arquitectura offline-first. La sincronización con el servidor es un proceso
 *  posterior y separado, que lee de `cola_sincronizacion`.
 */
import * as SQLite from 'expo-sqlite';

import { calcularAtributos } from '../dominio/sendero';
import { Nivel, Pronostico, Punto, Sendero } from '../dominio/tipos';
import { MIGRACIONES } from './esquema';

const NOMBRE_BD = 'trekkapp.db';

let bd: SQLite.SQLiteDatabase | null = null;

/** Abre la base y aplica las migraciones pendientes. Idempotente. */
export async function abrirBd(): Promise<SQLite.SQLiteDatabase> {
  if (bd) return bd;

  const conexion = await SQLite.openDatabaseAsync(NOMBRE_BD);
  await conexion.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const fila = await conexion.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const versionActual = fila?.user_version ?? 0;

  for (let v = versionActual; v < MIGRACIONES.length; v++) {
    await conexion.execAsync(MIGRACIONES[v]);
    await conexion.execAsync(`PRAGMA user_version = ${v + 1}`);
  }

  bd = conexion;
  return bd;
}

/** Cierra la base. Solo se usa en pruebas y al reiniciar el almacenamiento. */
export async function cerrarBd(): Promise<void> {
  await bd?.closeAsync();
  bd = null;
}

const ahora = () => new Date().toISOString();

// ---------------------------------------------------------------- perfil --

export async function leerNivel(): Promise<Nivel | null> {
  const db = await abrirBd();
  const fila = await db.getFirstAsync<{ nivel: Nivel }>(
    'SELECT nivel FROM perfil WHERE id = 1',
  );
  return fila?.nivel ?? null;
}

export async function guardarNivel(nivel: Nivel): Promise<void> {
  const db = await abrirBd();
  await db.runAsync(
    `INSERT INTO perfil (id, nivel, actualizado_en) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET nivel = excluded.nivel,
                                   actualizado_en = excluded.actualizado_en`,
    nivel,
    ahora(),
  );
}

// -------------------------------------------------------------- senderos --

interface FilaSendero {
  id: string;
  nombre: string;
  descripcion: string | null;
  distancia_m: number;
  desnivel_m: number;
  indice_esfuerzo: number;
  exigencia: Nivel;
  estado: Sendero['estado'];
}

/** Resumen de un sendero sin sus puntos, para listarlos sin costo de memoria. */
export type ResumenSendero = Omit<Sendero, 'puntos'>;

const aResumen = (f: FilaSendero): ResumenSendero => ({
  id: f.id,
  nombre: f.nombre,
  descripcion: f.descripcion ?? undefined,
  estado: f.estado,
  atributos: {
    distanciaM: f.distancia_m,
    desnivelAcumuladoM: f.desnivel_m,
    indiceEsfuerzo: f.indice_esfuerzo,
    exigencia: f.exigencia,
  },
});

/**
 * Guarda un sendero con su traza.
 *
 * Los atributos técnicos se calculan acá a partir de los puntos y no se
 * reciben desde afuera: así no hay forma de que alguien publique un recorrido
 * declarando una exigencia que no se corresponde con su traza.
 */
export async function guardarSendero(entrada: {
  id: string;
  nombre: string;
  descripcion?: string;
  puntos: Punto[];
  origen: 'precargado' | 'importado';
  estado?: Sendero['estado'];
}): Promise<ResumenSendero> {
  const db = await abrirBd();
  const attrs = calcularAtributos(entrada.puntos);
  // Un recorrido aportado por un caminante entra pendiente de revisión.
  const estado =
    entrada.estado ?? (entrada.origen === 'importado' ? 'pendiente_revision' : 'publicado');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO senderos
         (id, nombre, descripcion, distancia_m, desnivel_m, indice_esfuerzo,
          exigencia, estado, origen, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         nombre = excluded.nombre,
         descripcion = excluded.descripcion,
         distancia_m = excluded.distancia_m,
         desnivel_m = excluded.desnivel_m,
         indice_esfuerzo = excluded.indice_esfuerzo,
         exigencia = excluded.exigencia`,
      entrada.id,
      entrada.nombre,
      entrada.descripcion ?? null,
      attrs.distanciaM,
      attrs.desnivelAcumuladoM,
      attrs.indiceEsfuerzo,
      attrs.exigencia,
      estado,
      entrada.origen,
      ahora(),
    );

    await db.runAsync('DELETE FROM puntos WHERE sendero_id = ?', entrada.id);
    for (let i = 0; i < entrada.puntos.length; i++) {
      const p = entrada.puntos[i];
      await db.runAsync(
        'INSERT INTO puntos (sendero_id, orden, lat, lon, ele, tiempo) VALUES (?, ?, ?, ?, ?, ?)',
        entrada.id,
        i,
        p.lat,
        p.lon,
        p.ele ?? null,
        p.tiempo ?? null,
      );
    }
  });

  return {
    id: entrada.id,
    nombre: entrada.nombre,
    descripcion: entrada.descripcion,
    atributos: attrs,
    estado,
  };
}

export async function listarSenderos(): Promise<ResumenSendero[]> {
  const db = await abrirBd();
  const filas = await db.getAllAsync<FilaSendero>(
    `SELECT id, nombre, descripcion, distancia_m, desnivel_m, indice_esfuerzo,
            exigencia, estado
       FROM senderos ORDER BY nombre`,
  );
  return filas.map(aResumen);
}

/** Carga la traza completa. Solo se llama al abrir un sendero, no al listarlos. */
export async function leerPuntos(senderoId: string): Promise<Punto[]> {
  const db = await abrirBd();
  const filas = await db.getAllAsync<{
    lat: number;
    lon: number;
    ele: number | null;
    tiempo: string | null;
  }>('SELECT lat, lon, ele, tiempo FROM puntos WHERE sendero_id = ? ORDER BY orden', senderoId);

  return filas.map((f) => ({
    lat: f.lat,
    lon: f.lon,
    ...(f.ele !== null ? { ele: f.ele } : {}),
    ...(f.tiempo !== null ? { tiempo: f.tiempo } : {}),
  }));
}

export async function marcarDescargado(senderoId: string): Promise<void> {
  const db = await abrirBd();
  await db.runAsync('UPDATE senderos SET descargado_en = ? WHERE id = ?', ahora(), senderoId);
}

// -------------------------------------------------------------- reportes --

export interface NuevoReporte {
  id: string;
  senderoId: string;
  tipo: string;
  comentario?: string;
  lat?: number;
  lon?: number;
}

/**
 * Guarda un reporte y lo encola para sincronizar, en una sola transacción.
 *
 * Que ambas escrituras sean atómicas es lo que garantiza que no quede un
 * reporte guardado pero nunca enviado, ni una entrada en la cola sin su
 * reporte.
 */
export async function guardarReporte(r: NuevoReporte): Promise<void> {
  const db = await abrirBd();
  const creado = ahora();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO reportes (id, sendero_id, tipo, comentario, lat, lon, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      r.id,
      r.senderoId,
      r.tipo,
      r.comentario ?? null,
      r.lat ?? null,
      r.lon ?? null,
      creado,
    );
    await db.runAsync(
      `INSERT INTO cola_sincronizacion (entidad, entidad_id, operacion, creado_en)
       VALUES ('reporte', ?, 'alta', ?)
       ON CONFLICT (entidad, entidad_id, operacion) DO NOTHING`,
      r.id,
      creado,
    );
  });
}

export async function contarPendientesDeSincronizar(): Promise<number> {
  const db = await abrirBd();
  const fila = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM cola_sincronizacion',
  );
  return fila?.n ?? 0;
}

// ----------------------------------------------------------- pronósticos --

export async function guardarPronostico(
  senderoId: string,
  p: Pronostico,
): Promise<void> {
  const db = await abrirBd();
  await db.runAsync(
    `INSERT INTO pronosticos
       (sendero_id, fecha, precipitacion_mm, viento_kmh, temp_min_c, temp_max_c, obtenido_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sendero_id, fecha) DO UPDATE SET
       precipitacion_mm = excluded.precipitacion_mm,
       viento_kmh = excluded.viento_kmh,
       temp_min_c = excluded.temp_min_c,
       temp_max_c = excluded.temp_max_c,
       obtenido_en = excluded.obtenido_en`,
    senderoId,
    p.fecha,
    p.precipitacionMm,
    p.vientoKmh,
    p.temperaturaMinC,
    p.temperaturaMaxC,
    ahora(),
  );
}

/** Devuelve el pronóstico guardado junto con el momento en que se obtuvo. */
export async function leerPronostico(
  senderoId: string,
  fecha: string,
): Promise<{ pronostico: Pronostico; obtenidoEn: string } | null> {
  const db = await abrirBd();
  const f = await db.getFirstAsync<{
    fecha: string;
    precipitacion_mm: number;
    viento_kmh: number;
    temp_min_c: number;
    temp_max_c: number;
    obtenido_en: string;
  }>('SELECT * FROM pronosticos WHERE sendero_id = ? AND fecha = ?', senderoId, fecha);

  if (!f) return null;
  return {
    pronostico: {
      fecha: f.fecha,
      precipitacionMm: f.precipitacion_mm,
      vientoKmh: f.viento_kmh,
      temperaturaMinC: f.temp_min_c,
      temperaturaMaxC: f.temp_max_c,
    },
    obtenidoEn: f.obtenido_en,
  };
}

// ------------------------------------------------------------ alertas --

/** Deja constancia de una alerta emitida y, si corresponde, de la decisión del usuario. */
export async function registrarAlerta(a: {
  senderoId?: string;
  tipo: 'desvio' | 'clima' | 'nivel';
  detalle?: string;
  aceptada?: boolean;
}): Promise<void> {
  const db = await abrirBd();
  await db.runAsync(
    `INSERT INTO alertas_emitidas (sendero_id, tipo, detalle, aceptada, emitida_en)
     VALUES (?, ?, ?, ?, ?)`,
    a.senderoId ?? null,
    a.tipo,
    a.detalle ?? null,
    a.aceptada === undefined ? null : a.aceptada ? 1 : 0,
    ahora(),
  );
}
