# TrekkApp

Prototipo de aplicación móvil para la navegación asistida de senderos de montaña sin
conectividad. El sistema tiene dos piezas que se ejecutan por separado. La aplicación móvil
está construida con React Native y Expo, se instala en el teléfono y funciona sin señal. El
servidor de sincronización está construido con Fastify y PostgreSQL, entrega el catálogo, la
cartografía y el pronóstico, y recibe los reportes que la aplicación genera durante el
recorrido.

Trabajo Final de Grado de Ingeniería en Software. Prototipado Tecnológico, Universidad Siglo
21, 2026. Luciana Gallardo, legajo SOF02835.

## Contenido del repositorio

| Carpeta | Contenido |
| --- | --- |
| [`app/`](./app) | Pantallas y navegación de la aplicación móvil. |
| [`src/`](./src) | Lógica de dominio, base de datos local, sincronización y componentes de interfaz. |
| [`server/`](./server) | Servidor de sincronización, migraciones y generadores de datos. |
| [`tiles/`](./tiles) | Guion de generación de la cartografía vectorial. |
| [`docs/`](./docs) | Documentación técnica y registros de decisiones de arquitectura. |

## Requisitos previos

| Componente | Versión | Para qué sirve |
| --- | --- | --- |
| Node.js | 20 o superior | Ejecuta el servidor y el empaquetador de la aplicación. |
| PostgreSQL | 14 o superior | Base de datos del servidor. |
| Expo Go | la del SDK 58 | Ejecuta la aplicación en el teléfono. |
| Teléfono Android o iOS | cualquiera reciente | El prototipo se prueba en un dispositivo real. |

Expo Go se descarga sin costo desde Google Play o la App Store. Admite una única versión del
SDK por vez, de modo tal que conviene instalarla actualizada.

> **El teléfono y la computadora deben estar en la misma red Wi-Fi.** La aplicación deduce la
> dirección del servidor a partir del host de Expo, que es de donde recibió el paquete, y sin
> esa condición no puede alcanzarlo.

## Instalación

### 1. Dependencias

La aplicación y el servidor tienen conjuntos de dependencias distintos, así que hay que
instalar los dos.

```bash
npm install
cd server
npm install
cd ..
```

### 2. Base de datos

Creá una base de datos vacía. El nombre es indistinto siempre que coincida con el que vas a
configurar en el paso siguiente.

```bash
createdb trekkapp
```

Dentro de `server/`, copiá el archivo de ejemplo de configuración.

```bash
cd server
cp .env.example .env
```

Hay dos variables que necesitan un valor propio. El resto de
[`server/.env.example`](./server/.env.example) puede quedar como viene.

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | `postgres://localhost:5432/trekkapp`, ajustando usuario y puerto si corresponde. |
| `JWT_SECRET` | Una cadena larga y aleatoria, porque firma los tokens de sesión. |

Después aplicá las migraciones y cargá el catálogo de senderos, siempre dentro de `server/`.

```bash
npm run migrate
npm run seed
```

El sembrado incorpora 102 senderos de las Sierras de Córdoba generados a partir de
OpenStreetMap. La operación es idempotente, de modo tal que repetirla actualiza las filas en
lugar de duplicarlas.

### 3. Cartografía

Los archivos `.mbtiles` con el mapa base y las curvas de nivel viven en `tiles/out/` y **no
están versionados**. Pesan 46 MB en total, demasiado para un repositorio, así que
[`tiles/.gitignore`](./tiles/.gitignore) ignora esa carpeta entera. Clonar el repositorio no
los trae.

Sin esos archivos la aplicación funciona, pero el mapa queda vacío, de modo tal que hay que
conseguirlos de una de estas dos maneras.

1. Copiarlos a `tiles/out/` dentro de la raíz del proyecto, si se recibieron por separado
   junto con la entrega.
2. Regenerarlos, que lleva varios minutos y descarga decenas de megabytes. El mapa base se
   produce con `./generate.sh sierras-de-cordoba` dentro de `tiles/`, y las curvas de nivel
   con `npm run contours -- sierras-de-cordoba` dentro de `server/`. El detalle del proceso
   está en [`tiles/README.md`](./tiles/README.md).

El servidor los sirve desde `tiles/out/` sin configuración adicional. La variable `TILES_DIR`
sólo hace falta si se los guarda en otro lugar.

## Ejecución

El servidor y el empaquetador corren a la vez, cada uno en su terminal.

### Servidor

Desde `server/`.

```bash
npm run dev
```

Queda escuchando en el puerto 4000 e informa dos direcciones, una local y una de red. La
segunda es la que alcanza el teléfono.

### Aplicación

Desde la raíz del proyecto.

```bash
npx expo start --clear --go
```

La terminal muestra un código QR. En Android se escanea desde la propia aplicación Expo Go.
En iOS se escanea con la cámara del sistema, que ofrece abrirlo en Expo Go. La primera carga
demora algunos segundos mientras se arma el paquete y las siguientes son inmediatas.

## Primer uso

### El código de verificación se lee en la terminal del servidor

Esta instalación no tiene configurado un proveedor de correo, porque esas credenciales
pertenecen a quien opera el servidor y no se distribuyen con el código. El servidor avisa al
iniciar que el correo no está configurado y escribe cada código de verificación en su propia
salida en lugar de enviarlo. **Sin leer ahí el código no se puede completar el registro.**

El alta pide nombre, correo, contraseña y nivel de experiencia, y termina con las
preferencias de sendero. La dirección de correo puede ser cualquiera, incluso inventada,
porque nada se envía. Cuando la aplicación pide el código de seis dígitos, buscalo en la
terminal donde corre el servidor, en una línea con esta forma.

```text
mail not sent to prueba@ejemplo.test: Tu código para confirmar la dirección es 462019. Vence en 15 minutos y sirve una sola vez...
```

En el ejemplo el código es `462019`. Escribir esos seis dígitos en el teléfono completa el
registro. La recuperación de contraseña usa el mismo mecanismo y se lee en el mismo lugar.

### Recorrido sugerido

1. Desde el catálogo, abrí un sendero y revisá su perfil altimétrico, su clasificación de
   exigencia y el pronóstico por horas.
2. Descargá el sendero. Con la descarga queda disponible la cartografía con curvas de nivel
   para usar sin conexión.
3. Iniciá el recorrido. Si la exigencia del sendero supera el nivel declarado, el sistema
   pide una confirmación explícita antes de continuar.
4. Durante el recorrido, registrá un reporte de estado del camino señalando el punto sobre la
   traza.
5. Poné el teléfono en modo avión y comprobá que el mapa, la traza y la detección de desvío
   siguen funcionando.
6. Restituí la conexión y sincronizá desde el inicio. El reporte viaja al servidor y el
   catálogo local se actualiza.

## Pruebas automatizadas

El prototipo incluye 393 pruebas. Las de la aplicación cubren la lógica de dominio y no
requieren base de datos. Las del servidor se ejecutan contra una base de datos real, de modo
tal que necesitan la configuración descripta más arriba.

| Orden | Carpeta | Casos |
| --- | --- | --- |
| `npm test` | raíz | 197 |
| `npm test` | `server/` | 196 |

La verificación de tipos se ejecuta con `npx tsc --noEmit` en cada una de las dos carpetas.

## Documentación técnica

| Documento | Contenido |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | Diseño general y de ejecución del sistema. |
| [`docs/data-model.md`](./docs/data-model.md) | Modelo de datos local y remoto. |
| [`docs/integrations.md`](./docs/integrations.md) | Bibliotecas, capacidades nativas y servicios externos. |
| [`docs/adr/`](./docs/adr/README.md) | Diecisiete registros de decisiones de arquitectura, cada uno con su contexto, lo decidido y lo que cuesta. |

## Límites conocidos de esta instalación

| Situación | Motivo |
| --- | --- |
| Los códigos de verificación no llegan por correo. | Las credenciales del proveedor de correo no se distribuyen con el código, así que se leen en la salida del servidor. |
| La cartografía cubre únicamente las Sierras de Córdoba. | Es la región de prueba definida para el prototipo. |
| Los archivos de cartografía no vienen con el repositorio. | Pesan 46 MB y son reproducibles con el guion de generación. |
| El servidor se ejecuta en la red local y no en un proveedor de alojamiento. | El despliegue no forma parte del alcance de esta entrega. |
| La medición de consumo de batería requiere un dispositivo físico. | Está disponible en Perfil, apartado Mediciones, y se completa con una caminata real. |

## Resolución de problemas frecuentes

| Síntoma | Causa habitual |
| --- | --- |
| La aplicación no alcanza el servidor. | El teléfono está en otra red, o el servidor no está en ejecución. |
| Expo Go informa una incompatibilidad de versión. | La versión instalada de Expo Go corresponde a otro SDK y se resuelve actualizándola. |
| El empaquetador no reconoce un paquete recién instalado. | Quedó en ejecución desde antes y se resuelve reiniciándolo con `--clear`. |
| El servidor no inicia y menciona la base de datos. | `DATABASE_URL` no apunta a una base existente, o PostgreSQL no está en ejecución. |
| El catálogo aparece vacío. | Falta ejecutar `npm run seed` dentro de `server/`. |
| El mapa se ve vacío con el resto de la pantalla funcionando. | Faltan los archivos `.mbtiles` en `tiles/out/`. |

## Atribución de datos

Los trazados del catálogo provienen de OpenStreetMap y se usan bajo licencia ODbL. Las
alturas y las curvas de nivel se derivan de las capas públicas de terreno del registro de
datos abiertos de AWS.
