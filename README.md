# TSP Logistics

A lightweight delivery management frontend.

## Run locally

Open `index.html` in a browser. Add deliveries with a delivery date, DR number,
truck plate number, customer name, and destination. Each entry is shown in the
delivery list for the current page session.

Rates remain pending until a TiDB-backed service is connected. Deliveries are
currently held in browser memory and are cleared when the page is reloaded.
If the page or an add-delivery operation takes 3 seconds or longer, a loading
animation appears until it finishes.
