# Vuela — alertas de precios de vuelos

Aplicación local para Windows que administra seguimientos, consulta Google Flights con Chromium headless y envía alertas a través de EmailJS por HTTPS. La interfaz y el proceso se ejecutan en el mismo equipo y solo escuchan en `127.0.0.1:3030`.

## Inicio en Windows sin ventana de consola

Abre `INICIAR_VUELA_SILENCIOSO.vbs` para iniciar la app sin mostrar una ventana de CMD. El lanzador comprueba `http://127.0.0.1:3030`; si Vuela ya esta activa, no inicia un segundo scheduler. En ambos casos abre la app en el navegador predeterminado, en una pestaña nueva si el navegador ya esta abierto.

Tambien esta disponible `INICIAR_VUELA.bat`. Para que no se vea CMD, abre el archivo `.vbs`.

El lanzador no instala dependencias ni modifica variables de entorno o el Registro. Si Vuela no inicia, consulta `data/launcher.log` y `data/app.log`.

## Requisitos

- Windows con Node.js LTS y npm.
- Conexión a Internet.
- La app debe permanecer ejecutándose. La pantalla puede estar bloqueada, pero Windows debe seguir despierto; suspensión e hibernación detienen las consultas.
- Para enviar correos, una cuenta EmailJS conectada a Gmail.

## Primera instalacion

1. Ejecuta `npm install` y `npm run playwright:install` una sola vez desde la terminal de VS Code.
2. Para los siguientes inicios, abre `INICIAR_VUELA_SILENCIOSO.vbs`. El lanzador inicia el servidor en segundo plano si hace falta y abre `http://127.0.0.1:3030`.
3. Si la app no inicia, revisa `data/launcher.log` y `data/app.log`.

El inicio silencioso mantiene el scheduler activo en segundo plano. Para cerrarlo, detén el proceso de Node que ejecuta Vuela desde el Administrador de tareas o reinicia Windows.

## Envío de correo con EmailJS

1. Crea una cuenta en [EmailJS](https://www.emailjs.com/) y conecta Gmail desde **Email Services → Add New Service → Gmail**. Autoriza el permiso para enviar correo en nombre de tu cuenta.
2. En **Email Templates**, crea una plantilla y configura **To Email** como `{{to_email}}`, **Subject** como `{{subject}}` y el contenido HTML como `{{{html_body}}}`. Usa el correo predeterminado del servicio como remitente.
3. Guarda y copia el **Service ID** y **Template ID**. En **Account**, copia el **Public Key**. La **Private Key** es opcional.
4. En Vuela → **Configuración**, desbloquea la bóveda y pega los identificadores y claves en **Envío por EmailJS**. La Private Key, si la agregas, se cifra localmente con AES-256-GCM dentro de DuckDB.
5. Configura el correo destinatario en el formulario de preferencias y pulsa **Guardar configuración**. Después pulsa **Guardar EmailJS** y **Enviar correo de prueba**. La prueba envía un correo real.

Vuela usa la API HTTPS de EmailJS, no SMTP. La cuenta Gmail se conecta directamente en el panel de EmailJS; no se guarda la contraseña de Gmail ni requiere crear un proyecto OAuth propio. La bóveda debe permanecer desbloqueada durante los envíos. EmailJS procesa el contenido y el destinatario de cada correo. El plan gratuito indicado por EmailJS permite 200 solicitudes de envío al mes; revisa el límite actual en tu panel.

## Uso y límites iniciales

- Configura alertas de solo ida o ida/vuelta, aeropuertos IATA, fechas exactas o rangos, adultos y límite total en COP.
- En ida/vuelta se admiten hasta 50 pares de fechas y al menos una noche. Los rangos flexibles admiten hasta 31 días por tramo; el horizonte máximo es 365 días.
- La app selecciona los días dentro del calendario para que Google muestre los precios. Nunca pulsa **Buscar**. Los días sin precio se omiten.
- Solo compara valores COP contra el límite. Otros importes se guardan con su moneda y no generan alertas.
- Cada seguimiento que tenga coincidencias recibe un correo por ejecución, con todas sus combinaciones que cumplen el límite.
- Las horas diarias usan la zona `America/Bogota`; por defecto 08:00, 13:00 y 21:00. Las ejecuciones procesan seguimientos activos secuencialmente; no hay recuperación de horas perdidas cuando la app estaba cerrada.
- El historial conserva cinco días por defecto; el valor puede cambiarse en Ajustes.
- Los datos de la aplicación están en `data/vuela.duckdb`. Cópialo con Vuela cerrada para hacer una copia de respaldo.

## Comprobaciones de desarrollo

```powershell
npm run typecheck
npm test
npm run build
```
