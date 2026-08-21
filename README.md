# INFINITE — sitio web + bandeja de solicitudes

Sitio de una página con formulario de contacto y un panel de administración
donde llegan todas las solicitudes.

```
index.html            el sitio
admin.html            la bandeja de solicitudes
config.js             ← el único archivo que editas
supabase-setup.sql    para crear la base de datos
vercel.json           configuración de despliegue
```

---

## Funciona ahora mismo, sin instalar nada

Abre `index.html` en cualquier navegador. El formulario ya:

- valida los campos
- envía por **WhatsApp** al (787) 356-2397
- o abre tu correo con el mensaje ya redactado

Abre `admin.html` y entra con cualquier email para ver la bandeja
en modo demostración.

---

## Para guardar las solicitudes de verdad (30 minutos)

### 1. Supabase — la base de datos

1. Entra a [supabase.com](https://supabase.com) → **New project** (plan gratis)
2. Ve a **SQL Editor** → pega el contenido de `supabase-setup.sql` → **Run**
3. Ve a **Authentication → Users → Add user**
   Crea tu usuario admin con email y contraseña. Con ese entras al panel.
4. Ve a **Settings → API** y copia:
   - **Project URL**
   - **anon public** key
5. Pégalas en `config.js`:

```js
SUPABASE_URL:      'https://xxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGci...',
```

Y aprovecha para poner tu correo real en `CONTACT_EMAIL`.

> La llave `anon` es pública, va en el navegador a propósito. Lo que protege
> los datos son las políticas del SQL: cualquiera puede **enviar** el formulario,
> pero solo alguien con sesión iniciada puede **ver, editar o borrar**.

### 2. GitHub — guardar el código

```bash
cd carpeta-del-proyecto
git init
git add .
git commit -m "INFINITE website"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/infinite-website.git
git push -u origin main
```

Si prefieres sin comandos: en github.com haz **New repository**,
y arrastra los archivos a la página.

### 3. Vercel — publicar

1. [vercel.com](https://vercel.com) → **Add New → Project**
2. Importa el repositorio de GitHub
3. Framework preset: **Other**. No hay que compilar nada.
4. **Deploy**

Listo:

- Sitio: `https://tu-proyecto.vercel.app`
- Panel: `https://tu-proyecto.vercel.app/admin`

Cada vez que subas un cambio a GitHub, Vercel lo publica solo.

---

## El panel de admin

- **Bandeja** con todas las solicitudes, la más reciente arriba
- **Contadores**: total, nuevos, en proceso, cerrados
- **Buscador** por nombre, negocio, email o servicio
- **Filtros** por estado
- Toca una solicitud para abrirla:
  - editar cualquier campo
  - cambiar el estado
  - **notas internas** ("llamada hecha", "propuesta enviada")
  - **Guardar** / **Borrar**
  - botones directos de **WhatsApp** y **Responder por correo**
- **Exportar CSV** para abrir todo en Excel

---

## ¿Hay algo más simple que Supabase?

Sí, dos caminos, según qué te importe más:

| Opción | Ventaja | Desventaja |
|---|---|---|
| **Supabase** (lo que está montado) | Panel propio dentro de tu web, notas, editar, borrar. Se ve profesional. | Hay que crear el proyecto una vez |
| **Formspree** | 5 minutos, cero configuración | La bandeja es la de ellos: no hay notas ni edición |
| **Google Sheets** | Todo cae en una hoja de cálculo que ya sabes usar | Hay que pegar un script en Apps Script; no hay panel bonito |

Si algún día quieres cambiar, solo se toca la parte del envío en `index.html`
y `config.js`. El diseño no se entera.

---

## Cambiar contenido

Todo el texto está en `index.html`, en español y ordenado por secciones.
Para el video: busca `video-frame` y cambia el `alert` por un `<iframe>` de
YouTube o un `<video>`. Para las fotos del equipo: busca `.member .photo`
y cambia el `background-image` por la foto real.
