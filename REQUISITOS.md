# Documento maestro: seguimiento de precios de Google Flights

## 1. Objetivo

Aplicación local de uso personal para configurar varios seguimientos de vuelos. En horarios diarios configurados, una automatización con Playwright y Chromium headless abre Google Flights, lee los precios visibles en el calendario y envía un correo si encuentra resultados que cumplen el límite de precio.

La app se ejecutará en un computador Windows que permanece encendido y se utilizará desde un navegador de ese mismo computador. Debe continuar ejecutándose con Windows activo y también cuando la pantalla esté bloqueada. El proceso debe permanecer abierto en segundo plano; la pestaña del navegador de la interfaz no es la que realiza las consultas.

## 2. Alcance

### Incluido en la primera versión

- Crear, editar, pausar, activar y eliminar seguimientos de vuelos.
- Consultar vuelos de solo ida o ida y vuelta.
- Configurar fechas exactas o flexibles para cada tramo de forma independiente.
- Configurar únicamente pasajeros adultos, con al menos un adulto por seguimiento.
- Comparar el precio total en COP con un límite inclusivo.
- Ejecutar diariamente en una o varias horas de Bogotá.
- Ejecutar manualmente un seguimiento o todos los seguimientos activos.
- Enviar un correo por seguimiento con todos los resultados aplicables de esa ejecución.
- Conservar historial durante cinco días; el período se podrá cambiar desde la app.
- Usar Gmail conectado a EmailJS y enviar mensajes a través de su API HTTPS; guardar la configuración en la bóveda local cifrada.
- Ejecutar Chromium en modo headless para que Windows pueda permanecer bloqueado.

### Fuera de alcance de la primera versión

- Pasajeros menores de edad.
- Filtro de vuelos directos.
- Selección de clase de cabina; se usa turista.
- Viajes multi-ciudad.
- Acceso desde un segundo computador.
- Copias de seguridad automáticas de la base de datos.

## 3. Tecnología y arquitectura

- **Runtime:** Node.js con TypeScript.
- **Interfaz:** Next.js y Tailwind CSS, en español.
- **Automatización:** Playwright con Chromium en modo headless.
- **Persistencia:** DuckDB.
- **Zona horaria:** `America/Bogota`.
- **Correo:** Gmail conectado a EmailJS; los envíos usan la API HTTPS y la configuración se protege con la bóveda local.

DuckDB se ejecutará como base de datos local. La interfaz Next.js, sus rutas y el scheduler compartirán una única instancia del proceso Node que escribe en el archivo DuckDB. No se deben iniciar procesos independientes que escriban al mismo archivo. Para Node se usará el cliente vigente DuckDB Node Neo, `@duckdb/node-api`; el paquete antiguo `duckdb` está deprecado. [Concurrencia de DuckDB](https://duckdb.org/docs/current/connect/concurrency) · [Cliente DuckDB para Node](https://duckdb.org/docs/lts/clients/node_neo/overview).

El usuario iniciará la app manualmente y la dejará ejecutándose. No se crearán variables de entorno, claves del Registro, tareas programadas, servicios de Windows ni otros cambios persistentes del sistema operativo. Cerrar la pestaña de la interfaz no detendrá el scheduler. La máquina debe permanecer despierta: la pantalla bloqueada es compatible con la automatización headless, pero la suspensión o hibernación detiene la ejecución mientras dure. Playwright funciona headless por defecto. [Playwright headless](https://playwright.dev/docs/library).

## 4. Configuración de un seguimiento

Cada seguimiento incluirá:

| Campo | Regla |
|---|---|
| Nombre | Etiqueta legible para reconocerlo en panel, historial y correo. |
| Origen | Un código IATA de aeropuerto, por ejemplo Cali `CLO`. |
| Destino | Un código IATA de aeropuerto. |
| Tipo de viaje | Solo ida o ida y vuelta. |
| Fecha de salida | Fecha exacta o rango inclusivo. |
| Fecha de regreso | Solo ida y vuelta; fecha exacta o rango inclusivo, independiente de la salida. |
| Estadía | Opcional para ida y vuelta; duración exacta en noches y mínimo una noche. |
| Adultos | Cantidad de adultos, mínimo uno; valor inicial recomendado: uno. |
| Precio máximo | Precio total para todos los adultos, en COP. Se alerta si `precio <= límite`. |
| Estado | Activo o pausado. |

Para solo ida se muestra únicamente la configuración de salida. En ida y vuelta se puede elegir fecha exacta o rango por separado para salida y regreso. Si se configura duración, solo aplican las parejas de fechas con exactamente ese número de noches. Si no se configura, se consideran todas las combinaciones válidas de los rangos, con al menos una noche entre la salida y el regreso.

No se guardarán nombres, fechas de nacimiento ni otra información personal de pasajeros; solo la cantidad de adultos.

## 5. Horarios, ejecución y reintentos

- El usuario configura una o más horas fijas diarias, por ejemplo `08:00`, `13:00` y `21:00`.
- Todas las horas se interpretan en `America/Bogota`.
- Cada ejecución programada procesa todos los seguimientos activos, de forma secuencial.
- Un seguimiento pausado no se consulta.
- Si el proceso estaba apagado al llegar un horario, se omite esa ejecución y se espera a la siguiente. No se ejecuta una recuperación atrasada.
- Si una consulta falla, se registra el error y se vuelve a intentar en la siguiente hora programada. No habrá reintentos automáticos dentro de la misma ejecución.
- La duracion de estadia solo se muestra cuando al menos un tramo usa rango flexible.
- Historial incluye una accion para borrar todas las ejecuciones y sus resultados/notificaciones, sin afectar seguimientos ni ajustes.
- La clave maestra de la boveda se puede enviar con Enter mientras esta bloqueada.
- Si una hora concreta no muestra precio, se ignora esa fecha; no se considera un error de consulta.
- Se esperan unos cuatro seguimientos al inicio, con posibilidad de agregar más.
- No se permiten dos lotes de ejecución simultáneos. Recomendación adoptada: si un lote sigue activo cuando llega el siguiente horario, omitir ese lote programado y registrarlo como omitido por solapamiento.
- La app tendrá acciones manuales para ejecutar un seguimiento y para ejecutar todos los seguimientos activos. La ejecución manual se registra en el historial y no se inicia si ya hay un lote ejecutándose; la interfaz informa que debe esperar.

Cada lote y cada seguimiento guardarán hora prevista, inicio, fin y estado. Estados sugeridos: `completado`, `completado con resultados`, `sin precios`, `fallido`, `omitido por solapamiento` y `ejecución manual`.

## 6. Flujo de consulta de Google Flights

1. El proceso Node inicia Playwright y Chromium headless.
2. Abre `https://www.google.com/travel/flights`.
3. Configura solo ida/ida y vuelta, los códigos IATA, las fechas y la cantidad de adultos.
4. Abre el calendario y lee los precios visibles que correspondan a las fechas configuradas.
5. Omite los días sin precio visible.
6. Compara cada precio verificable en COP con el límite inclusivo.
7. Guarda resultados y errores en DuckDB.
8. Si el seguimiento obtuvo uno o más resultados que cumplen el límite, envía un solo correo con todos esos resultados.

### Restricción obligatoria

La automatización **nunca debe pulsar la opción “Buscar” ni iniciar la página de resultados mediante otra acción equivalente**. La lectura se limita a los precios que estén visibles en el calendario. Si una combinación no se puede verificar respetando esa regla, se registra como no verificable; no se inventa un precio ni se sustituye por el precio de otro tipo de viaje.

## 7. Definición de precio y resultado

- Un resultado es un precio visible en el calendario para una fecha o combinación de fechas configurada.
- El calendario puede mostrar el precio mínimo del día. Ese valor no necesariamente identifica aerolínea, horarios, escalas ni una opción concreta de compra.
- Se configurará Google Flights para Colombia/COP cuando la interfaz lo permita.
- No se hará conversión automática desde otra moneda. Si el calendario muestra otra moneda, se guardarán el importe, la moneda y la observación en el historial, y el resultado no se comparará ni generará alerta.
- La comparación de precio es inclusiva: `precio <= límite`.
- El precio es una observación hecha a la hora registrada. Google indica que pueden aplicar cargos adicionales por equipaje u otros conceptos. [Información de precios y cargos](https://support.google.com/travel/answer/2475306?hl=en).

## 8. Correos

- Hay un único destinatario común, editable desde Configuración.
- El remitente es una cuenta Gmail conectada desde EmailJS mediante la autorización del proveedor.
- Cada seguimiento que obtiene coincidencias en una ejecución produce un correo. Si el seguimiento tiene varias fechas/precios válidos, todos se agrupan en ese mensaje.
- Se manda un nuevo correo en cada ejecución que encuentre resultados bajo el límite, aunque ya se hubieran notificado antes.
- Si varios seguimientos tienen coincidencias en el mismo lote, se envía un correo por cada seguimiento.
- El mensaje incluye todo lo disponible en el calendario: nombre del seguimiento, origen, destino, tipo de viaje, número de adultos, fechas, noches si aplican, cada precio encontrado, moneda, límite, hora de consulta y enlace a Google Flights si se puede construir.
- “Incluir todo” cubre toda la información visible en el calendario. No promete datos del itinerario que no aparezcan allí, como aerolínea, horarios o escalas.
- Un fallo de envío se guarda en el historial. No hay reintento inmediato; se vuelve a consultar en el siguiente horario.

## 9. Historial y retención

El valor inicial de retención será cinco días. Se podrá cambiar desde la app. Al vencer el período, se eliminarán registros históricos antiguos; la limpieza no borrará las definiciones actuales de seguimientos ni la configuración. No se requieren copias de seguridad automáticas.

El historial mostrará:

- Fecha y tipo de ejecución (programada o manual), hora prevista, inicio y fin.
- Seguimiento consultado y copia de sus parámetros al momento de la ejecución.
- Precios, moneda, fechas, noches y resultado de la comparación.
- Envío de correo, destinatario, hora y error si ocurrió.
- Errores de navegación, lectura, moneda no COP, autenticación SMTP o envío.

Entidades lógicas sugeridas: `FollowUp`, `AppSettings`, `Run`, `RunResult` y `EmailNotification`. El historial de un seguimiento eliminado se conserva hasta vencer el período de retención.

## 10. Pantallas previstas

1. **Panel:** próximos horarios, resumen de seguimientos activos/pausados, actividad reciente y acción “Ejecutar todos ahora”.
2. **Seguimientos:** listado, estado y acciones para crear, editar, pausar, activar, eliminar o ejecutar uno ahora.
3. **Formulario:** nombre, aeropuertos IATA, tipo de viaje, fechas por tramo, duración, cantidad de adultos y límite COP.
   - Los campos de aeropuerto ofrecen coincidencias globales por nombre, ciudad o código IATA, mostrando código, aeropuerto, ciudad y país. La búsqueda usa un catálogo local derivado de OurAirports.
   - Escape fin de semana permite añadir de tres a cuatro destinos en campos separados. El precio se presenta en COP sin decimales y con separadores de miles.
4. **Historial:** ejecuciones, precios, moneda, correos y errores; filtros por seguimiento y fecha.
5. **Configuración:** horas diarias, destinatario común, configuración de EmailJS y días de retención.

## 11. Manejo de errores

- Separar un día sin precio de una página que no cargó o no pudo leerse.
- Registrar los errores con seguimiento, fecha/hora y etapa del proceso.
- Un cambio de interfaz, desafío de verificación, precio con moneda desconocida o error OAuth no debe interpretarse como ausencia de precios.
- Un error de consulta se vuelve a intentar solo en la siguiente ejecución programada.
- No guardar tokens, códigos OAuth ni cabeceras de autorización en logs.
- Recomendación: guardar una captura solo si la consulta falla y eliminarla cuando venza el historial asociado.

## 12. Envío de correo por EmailJS

Los mensajes se envían desde la cuenta Gmail que el usuario conecta en EmailJS. Vuela invoca la API de EmailJS mediante HTTPS; el equipo local no se conecta a SMTP. La app no solicita la contraseña normal ni una contraseña de aplicación de Gmail y no requiere crear un proyecto OAuth propio.

En la cuenta EmailJS se crea un servicio Gmail y una plantilla con estos campos dinámicos: destinatario `{{to_email}}`, asunto `{{subject}}` y cuerpo HTML `{{{html_body}}}`. Vuela guarda el Service ID, Template ID, Public Key y, opcionalmente, Private Key dentro de la bóveda local cifrada AES-256-GCM. La clave maestra se deriva con scrypt y permanece solo en memoria mientras la bóveda está desbloqueada. No se usan variables de entorno, el almacén de credenciales de Windows ni cambios del Registro.

La app proporciona una acción explícita para enviar un correo de prueba al destinatario configurado. El historial registra el resultado y el próximo horario programado vuelve a consultar si falló una ejecución. EmailJS procesa el contenido y destinatario de los correos; su plan gratuito tiene un límite mensual de solicitudes que debe revisarse en la cuenta del usuario.

## 13. Límites adoptados para la primera versión

Los límites iniciales quedaron definidos para permitir rangos flexibles útiles y mantener acotado el número de consultas por seguimiento:

- Las fechas de viaje no pueden estar a más de 365 días desde el día actual.
- Cada rango flexible tendrá como máximo 31 fechas consecutivas, contando ambos extremos.
- Ida y vuelta admite hasta 50 combinaciones válidas por seguimiento. La app selecciona cada par en el calendario y lee su precio sin pulsar Buscar. Solo si un precio cumple el umbral, pulsa Buscar para abrir resultados y obtener aerolíneas y horarios.
- No fijar un máximo rígido de seguimientos; procesarlos secuencialmente. El usuario espera unos cuatro al inicio.

El máximo de 50 combinaciones queda fijado para la primera versión. Los seguimientos se procesan secuencialmente y pueden tardar más cuando hay varios pares de ida y vuelta.

## 14. Riesgos y factibilidad

- En Chromium headless se comprobaron solo ida, un rango flexible de tres días y una ida/vuelta de tres noches; la automatización seleccionó fechas en el calendario sin pulsar Buscar.
- Se comprobó el selector de adultos con dos pasajeros; la clase turista se conserva por defecto.
- Si un día no muestra precio, se omite; los errores de consulta se guardan en el historial.
- Chromium headless puede ejecutar con la pantalla bloqueada si Windows sigue activo; la suspensión/hibernación detiene el proceso.
- Los precios de Google pueden cambiar y pueden excluir cargos opcionales; el correo representa una observación, no una tarifa garantizada.

## 15. Criterios de aceptación

- Crear cuatro seguimientos iniciales y poder agregar más desde la interfaz.
- Configurar solo ida/ida y vuelta, fechas exactas o rangos independientes, noches opcionales y al menos un adulto.
- Mantener la clase turista y no ofrecer filtro directo.
- Ejecutar los horarios diarios en `America/Bogota`, omitir ejecuciones perdidas y no solapar lotes.
- Ejecutar manualmente un seguimiento o todos los activos y registrar esas consultas.
- Seguir trabajando con Chromium headless cuando Windows está activo o con la pantalla bloqueada.
- No pulsar **Buscar** durante la consulta inicial del calendario. Solo después de encontrar un precio que cumple el umbral se permite pulsar Buscar para consultar detalles de vuelos.
- Omitir fechas sin precio; guardar en historial errores de consulta y valores en moneda distinta de COP.
- Comparar el precio total mostrado con el límite mediante `precio <= límite`.
- Enviar un correo por seguimiento y ejecución, agrupando horarios por precio y aerolínea; conservar cada pareja real ida-regreso en su propia línea y mostrar la aerolínea por tramo cuando difieran. Si no carga el detalle, enviar el precio del calendario como respaldo. Repetir en futuras ejecuciones si el precio sigue aplicando.
- Cambiar destinatario, horarios y retención desde la app.
- Conservar historial durante cinco días por defecto y permitir modificar la cantidad.
- No guardar contraseñas de Gmail ni depender del almacén de credenciales de Windows; cifrar la configuración de EmailJS en la bóveda local.

## 16. Supuestos y validaciones durante el desarrollo

1. **Límites de fechas v1:** horizonte máximo de 365 días y rangos flexibles de hasta 31 fechas consecutivas por tramo.
2. **Combinaciones ida/vuelta:** se fijo el limite inicial en 50 combinaciones por seguimiento. Cada par se selecciona y lee en el calendario; las fechas sin importe se omiten.
3. **Precio que no esté en COP:** se interpreta la respuesta del usuario como guardar en el historial el importe, moneda y observación; al no poder compararlo con un límite en COP, no convertirlo ni enviar alerta.
4. **Windows y bloqueo:** el usuario inicia la app manualmente y deja el proceso abierto. No se crean tareas, servicios, variables de entorno ni cambios en el Registro. Debe seguir funcionando con la pantalla bloqueada si el equipo permanece despierto; no se ejecuta durante suspensión o hibernación.
5. **Interfaz abierta:** “la app debe quedar abierta” se interpreta como mantener activo el proceso de la aplicación y su scheduler. La pestaña del navegador puede permanecer abierta como panel, pero no es necesaria para que corran las consultas.

## 17. Seguimiento "Escape fin de semana"

Este modo nuevo coexiste con los seguimientos de fechas configuradas y no cambia su comportamiento.

- Un origen y entre tres y cuatro destinos IATA por seguimiento; mínimo un adulto y un precio máximo total común en COP.
- Horizonte configurable, inicial de 120 días desde la fecha actual de Bogotá. El regreso del lunes puede quedar fuera del límite si la salida está dentro del horizonte.
- Salida viernes de 7:00 p. m. a 10:00 p. m. o sábado de 6:00 a. m. a 10:00 a. m.; regreso domingo de 4:00 p. m. a 8:00 p. m. y también lunes en ese horario cuando sea festivo nacional no laborable. Los límites horarios son inclusivos.
- Festivos calculados con la legislación colombiana vigente y sus reglas de traslado. El domingo por sí mismo no activa el regreso del lunes.
- Anticipación mínima configurable, inicial de ocho horas. Se valida con la fecha y hora local del aeropuerto de origen; si su zona horaria no está identificada, la ejecución se registra como error para evitar comparar mal el plazo.
- Hasta 200 combinaciones de destino, salida y regreso por ejecución.
- Primero se leen los precios totales del calendario sin pulsar Buscar. Solo si el precio cumple el umbral se abre la página de resultados para verificar aerolíneas, horarios y parejas reales.
- Un correo por ejecución con todos los resultados de todos los destinos que cumplan precio, horario y anticipación. Si Google no carga el detalle, se conserva el correo de respaldo con el precio del calendario y se indica que los horarios no pudieron verificarse.
- El destino y el estado de verificación de horarios se conservan en el historial.
