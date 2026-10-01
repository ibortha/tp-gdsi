# TP GDSI — Pedido Grupal (demo web)

Esta rama tiene **solo el sitio estático** de Pedido Grupal, listo para publicar en cualquier hosting (GitHub Pages,
Netlify, Vercel…). No necesita servidor ni base de datos: todo corre en el navegador con **datos de prueba**.

## Cómo se usa

Arriba de todo hay una barra roja de **Demo** con un selector **"Ver como"**:

- **Fede, Meli o Tomi · comensal**: tres amigos en la mesa 04, con pedidos ya hechos. Pueden pedir, ver la cuenta
  compartida y pagar por ítems (entero, ½, ⅓) o dividir el total.
- **Sentarme en la mesa (libre)**: entrar como un comensal nuevo, como si escanearas el QR.
- **Mozo / ADMIN**: el panel del local (salón, comandas, cobros con Posnet, carta, mesas y QR, métricas).
- **ADMIN · Métricas → Consumo**: lo más pedido, pedidos por horario, medios de pago, personas por mesa y un
  resumen por mesa, con una semana de datos de prueba.
- **Reiniciar** (↺): vuelve a los datos de prueba originales.

Los cambios se guardan en el navegador (localStorage). Si abrís dos pestañas —por ejemplo Fede en una y el mozo en
otra— se ven los cambios en vivo entre ambas. Usuarios de prueba del panel: `admin@pedidogrupal.test` / `admin1234` y
`mozo@pedidogrupal.test` / `mozo1234`.

## Cómo publicarlo

- **GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. Queda en
  `https://<usuario>.github.io/tp-gdsi/` (en repos privados GitHub Pages requiere un plan pago).
- **Netlify:** “Add new site” → importar este repo, rama `main`, sin comando de build y con publish directory `.`
  (o arrastrar la carpeta en *Netlify Drop*).
- **Vercel:** “Add New Project” → este repo, framework *Other*, sin build command, output directory `.`.

## Código fuente

El código completo (servidor Node + React, tests, documentación de decisiones y trazabilidad de User Stories) está en
la rama `claude/tender-cannon-g1gmcm`. Para regenerar este sitio: `npm install && npm run build:demo` y copiar el
contenido de `dist/demo/` a esta rama.
