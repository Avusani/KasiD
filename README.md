# KasiGo delivery website

Responsive delivery site with dedicated Buy (Order or Groceries) and Parcel (Send or Collect) choice pages, plus Food, Groceries, Buy For Me, Store Delivery, and Moving & Relocation services. The moving page describes bakkie and truck options for household furniture, office equipment and belongings, and bulky parcels. Customers can choose a website or WhatsApp path, browse individual store menus, create a private multi-store basket, and submit an order with a KasiGo reference number.

## Run locally

Requires Node.js 18 or newer.

On Windows, double-click `start-kasigo.bat`. It starts the Node server and opens the fully working site at `http://localhost:3000`. Opening `public/index.html` directly now shows a styled static preview; navigation, cart, admin, and checkout need the server.

```powershell
$env:ADMIN_USERS_JSON = '[{"username":"Avukile","password":"your-private-password"},{"username":"Ayanda","password":"another-private-password"}]'
npm start
```

Open `http://localhost:3000`. The owner dashboard is at `/admin`. Customers do not need to sign in. The admin password is required to protect the owner dashboard and its customer/order data.

## Admin controls

The dashboard manages the public display name and logo, homepage headline and intro, WhatsApp and contact details, About text, three rotating photos/videos (each slide stays for three seconds), the service-category background photo/video, categories and subcategories, store names and logos, products and product photos, prices, and store availability. It also lists submitted orders and active private baskets; admins can update order status, delivery fee and recorded payment amount, and manage other admin accounts.

The Analytics tab reports anonymous unique visitors today, over the last seven days, and this month, with daily, weekly, and monthly visitor/order line charts plus recent activity. Tracking uses a random browser ID and does not collect IP addresses.

Uploads accept PNG, JPEG, WebP, MP4 and WebM up to 5 MB per file. Images are resized in the browser. Website content, photos, orders, active baskets, admin password hashes and analytics are stored in PostgreSQL whenever `DATABASE_URL` is configured. Local development without that variable uses JSON files in `DATA_DIR` (defaults to `delivery-platform/data`).

## WhatsApp and orders

Add the business WhatsApp number in Admin → Homepage settings in international format using digits only. Example: `082 123 4567` becomes `27821234567`.

Checkout creates a unique KasiGo order reference and a server-side record. WhatsApp checkout opens a prefilled message containing the order ID, customer contact, stores, items, quantities, item subtotal, and receipt. The delivery fee is stated as pending confirmation, so the message shows the item subtotal plus the eventual delivery fee. Website checkout displays the order receipt and records the same order for the admin.

Each browser has its own anonymous cart ID; a customer’s basket is kept in that browser and is not returned to other customers. The customer can optionally add a phone number to the basket, and a phone number is required to submit an order. The admin dashboard can see submitted orders and active baskets.

The WhatsApp links hand the message to the customer’s WhatsApp app. Automated replies to incoming WhatsApp messages require a Meta WhatsApp Business Cloud API account, access token and webhook, which must be configured separately. This site does not collect online payments; the admin can record a payment and delivery fee after confirming them with the customer.

## Railway deployment

Push this folder as a GitHub repository and deploy it from Railway. Add a PostgreSQL service to the Railway project, then add a reference variable to the web service named `DATABASE_URL` with value `${{Postgres.DATABASE_URL}}` (choose the actual name of your Postgres service if it differs). The app creates its data table automatically and uses it for site content, uploads, orders, carts, admin password hashes and analytics. Railway deployments refuse to start without `DATABASE_URL`.

Before the first admin login, set `ADMIN_USERS_JSON` in the web service Variables with your chosen usernames and private passwords, for example `[{"username":"Owner","password":"use-a-private-password"}]`. The app stores salted password hashes in PostgreSQL and removes the bootstrap variable from its process after saving the accounts. You do not need a separate file volume for app data when using this PostgreSQL setup.
