# EMPIEZA AQUÍ — publicar desde el celular

Tres pasos. No hace falta computadora ni instalar nada.

---

## 1. Publicar el sitio (2 minutos)

1. Descarga el archivo **infinite-website.zip** a tu teléfono
2. Abre en el navegador: **app.netlify.com/drop**
3. Toca la zona de arrastrar → **elige el ZIP** desde tus archivos
4. Espera unos segundos

Ya está en línea. Te da una dirección tipo
`https://algo-random-123.netlify.app`

- Tu sitio: esa dirección
- Tu panel: esa dirección + **/admin.html**

Para cambiar el nombre: **Site settings → Change site name**.
Para poner tu dominio propio: **Domain settings → Add custom domain**.

> Netlify es lo más fácil desde el celular porque acepta el ZIP directo.
> Vercel necesita GitHub primero — está explicado en el README si lo prefieres.

---

## 2. Ya funciona sin hacer nada más

- El formulario envía por **WhatsApp al (787) 356-2397**
- O abre el correo con el mensaje redactado
- El panel `/admin.html` abre en modo demostración

Si solo quieres eso, aquí terminaste.

---

## 3. Guardar las solicitudes de verdad (15 minutos)

Para que todo caiga en tu bandeja y puedas poner notas:

1. **supabase.com** → crea cuenta → **New project** (gratis)
2. Menú **SQL Editor** → pega todo el contenido de `supabase-setup.sql` → **Run**
3. Menú **Authentication → Users → Add user** → crea tu usuario con email y contraseña
4. Menú **Settings → API** → copia **Project URL** y la llave **anon public**
5. Abre tu sitio en **/admin.html** → botón **Configurar Supabase** → pega las dos cosas → **Guardar y conectar**
6. Entra con el usuario que creaste en el paso 3

El panel ya está conectado en tu teléfono.

**Último detalle:** para que el formulario público también guarde ahí,
en esa misma pantalla toca **Copiar texto de config.js**. Luego en Netlify
ve a tu sitio → **Deploys** → arrastra otra vez el ZIP con el `config.js`
actualizado. O más fácil: edítalo desde GitHub si lo subiste allá.

---

## Lo que puedes hacer en el panel

- Ver todas las solicitudes, la más nueva arriba
- Buscar y filtrar por estado
- Abrir una solicitud, editarla y ponerle **notas internas**
- Marcarla como nuevo / en proceso / cerrado
- Borrarla
- Contestar por WhatsApp o correo con un toque
- Bajar todo en CSV para Excel
