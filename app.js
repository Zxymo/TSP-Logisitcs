const deliveryForm = document.querySelector("#delivery-form");
const deliveryDate = document.querySelector("#delivery-date");
const todayLabel = document.querySelector("#today-label");
const deliveryList = document.querySelector("#delivery-list");
const deliveryCountLabel = document.querySelector("#delivery-count");
const emptyState = document.querySelector("#empty-state");
const loadingOverlay = document.querySelector("#loading-overlay");
const loadingMessage = document.querySelector("#loading-message");
const destinationSelect = document.querySelector("#destination-select");
const lengthSelect = document.querySelector("#post-length");
const ratePreview = document.querySelector("#rate-preview");
const formMessage = document.querySelector("#form-message");
const deliveryMessage = document.querySelector("#delivery-message");
const submitButton = deliveryForm.querySelector('button[type="submit"]');
const exportButton = document.querySelector("#export-deliveries");
const connectionPill = document.querySelector("#connection-pill");
const connectionLabel = document.querySelector("#connection-label");
const connectionTitle = document.querySelector("#connection-title");
const connectionDescription = document.querySelector("#connection-description");
const bannerStatus = document.querySelector("#banner-status");
const bannerStatusLabel = document.querySelector("#banner-status-label");
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
});
const currencyFormatter = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
});
const apiBaseUrl = document.querySelector('meta[name="api-base-url"]').content.trim().replace(/\/+$/, "");
const truckCodeByLength = new Map([
    [40, "REG_40_45"],
    [45, "REG_40_45"],
    [50, "EXT_50"],
    [55, "EXT_55_60"],
    [60, "EXT_55_60"]
]);

const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
let routes = [];
let currentRate = null;
let deliveryCount = 0;
const activeLoadingTasks = new Set();

deliveryDate.value = localDate;
todayLabel.textContent = dateFormatter.format(today);
document.querySelector("#current-year").textContent = String(today.getFullYear());
submitButton.disabled = true;

function apiUrl(action, query = {}) {
    const url = new URL(`${apiBaseUrl}/api`, window.location.href);
    url.searchParams.set("action", action);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.href;
}

function startLoading(message) {
    const task = { timer: null };
    task.timer = window.setTimeout(() => {
        if (!activeLoadingTasks.has(task)) {
            return;
        }

        loadingMessage.textContent = message;
        loadingOverlay.hidden = false;
        document.body.setAttribute("aria-busy", "true");
    }, 3000);
    activeLoadingTasks.add(task);

    return () => {
        window.clearTimeout(task.timer);
        activeLoadingTasks.delete(task);

        if (activeLoadingTasks.size === 0) {
            loadingOverlay.hidden = true;
            document.body.removeAttribute("aria-busy");
        }
    };
}

async function runWithLoadingIndicator(message, operation) {
    const stopLoading = startLoading(message);

    try {
        return await operation();
    } finally {
        stopLoading();
    }
}

function setConnectionStatus(connected, description) {
    const status = connected ? "online" : "offline";
    connectionPill.dataset.status = status;
    bannerStatus.dataset.status = status;
    connectionLabel.textContent = connected ? "TiDB connected" : "TiDB unavailable";
    connectionTitle.textContent = connected ? "TiDB rate database connected" : "TiDB rate database is unavailable";
    connectionDescription.textContent = description;
    bannerStatusLabel.textContent = connected ? "Online" : "Offline";
}

async function requestJson(path, options) {
    const response = await fetch(path, options);
    let payload;

    try {
        payload = await response.json();
    } catch {
        throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status}).`);
    }

    return payload;
}

function appendDetail(details, label, value) {
    if (value === null || value === undefined || value === "") {
        return;
    }

    const field = document.createElement("div");
    field.className = "delivery-field";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value;

    field.append(term, description);
    details.append(field);
}

function formatDeliveryDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function renderDelivery(shipment, position) {
    const delivery = document.createElement("article");
    delivery.className = "delivery-item";
    delivery.setAttribute("aria-label", `Delivery ${position}: ${shipment.dr_number}`);

    const header = document.createElement("div");
    header.className = "delivery-item-top";

    const titleGroup = document.createElement("div");
    titleGroup.className = "delivery-title-group";

    const index = document.createElement("span");
    index.className = "delivery-index";
    index.textContent = `DELIVERY ${String(position).padStart(2, "0")}`;

    titleGroup.append(index);

    const actions = document.createElement("div");
    actions.className = "delivery-item-actions";

    const rateStatus = document.createElement("span");
    rateStatus.className = "delivery-rate-status";
    const statusDot = document.createElement("span");
    statusDot.className = "status-dot";
    statusDot.setAttribute("aria-hidden", "true");
    rateStatus.append(statusDot, document.createTextNode("Rate saved"));

    const archiveButton = document.createElement("button");
    archiveButton.className = "archive-button";
    archiveButton.type = "button";
    archiveButton.textContent = "Archive";
    archiveButton.addEventListener("click", () => archiveDelivery(shipment.id, archiveButton));
    actions.append(rateStatus, archiveButton);
    header.append(titleGroup, actions);

    const details = document.createElement("dl");
    details.className = "delivery-details";
    appendDetail(details, "DATE", formatDeliveryDate(shipment.delivery_date));
    appendDetail(details, "DR NO.", shipment.dr_number);
    appendDetail(details, "CUSTOMER'S NAME", shipment.customer_name);
    appendDetail(details, "DESTINATION", shipment.destination);
    appendDetail(details, "HAULING RATE", currencyFormatter.format(Number(shipment.price_php)));

    delivery.append(header, details);
    return delivery;
}

function renderDeliveries(deliveries) {
    deliveryList.querySelectorAll(".delivery-item").forEach((item) => item.remove());
    deliveries.forEach((shipment, index) => {
        deliveryList.append(renderDelivery(shipment, index + 1));
    });

    deliveryCount = deliveries.length;
    deliveryCountLabel.textContent = `${deliveryCount} ${deliveryCount === 1 ? "delivery" : "deliveries"}`;
    emptyState.hidden = deliveryCount > 0;
}

function populateDestinations(availableRoutes) {
    routes = availableRoutes;
    const destinations = new Map();
    routes.forEach((route) => {
        destinations.set(
            String(route.destination_id),
            `${route.destination_name}, ${route.province_name}`
        );
    });

    destinationSelect.replaceChildren(new Option("Select a delivery location", ""));
    destinations.forEach((name, id) => destinationSelect.add(new Option(name, id)));
    destinationSelect.disabled = destinations.size === 0;

    if (destinations.size === 0) {
        destinationSelect.replaceChildren(new Option("No active delivery locations", ""));
    }
    updateRatePreview();
}

function getMatchingRates() {
    const destinationId = destinationSelect.value;
    const truckCode = truckCodeByLength.get(Number(lengthSelect.value));
    if (!destinationId || !truckCode) {
        return [];
    }

    return routes.filter((route) =>
        String(route.destination_id) === destinationId && route.truck_code === truckCode
    );
}

function updateRatePreview() {
    currentRate = null;
    submitButton.disabled = true;

    if (!destinationSelect.value || !lengthSelect.value) {
        ratePreview.textContent = "Select a location and truck length to see the rate.";
        ratePreview.dataset.state = "";
        return;
    }

    const matches = getMatchingRates();
    if (matches.length === 0) {
        ratePreview.textContent = "No active rate is available for this location and length.";
        ratePreview.dataset.state = "error";
        return;
    }

    const rates = new Map();
    matches.forEach((rate) => {
        const key = `${rate.zone_id}:${Number(rate.rate_vat_inc)}`;
        if (!rates.has(key)) {
            rates.set(key, rate);
        }
    });
    if (rates.size !== 1) {
        ratePreview.textContent = "Multiple active rates match. Please contact an administrator.";
        ratePreview.dataset.state = "error";
        return;
    }

    currentRate = rates.values().next().value;
    ratePreview.textContent = `Rate (VAT inclusive): ${currencyFormatter.format(Number(currentRate.rate_vat_inc))}`;
    ratePreview.dataset.state = "ready";
    submitButton.disabled = false;
}

async function loadDashboard() {
    try {
        const dashboard = await requestJson(apiUrl("dashboard"));
        populateDestinations(dashboard.routes);
        renderDeliveries(dashboard.deliveries);
        setConnectionStatus(true, "Active destination rates and saved deliveries are loaded from TiDB.");
    } catch (error) {
        setConnectionStatus(false, error.message);
        destinationSelect.replaceChildren(new Option("Rates could not be loaded", ""));
        destinationSelect.disabled = true;
        updateRatePreview();
    }
}

async function archiveDelivery(id, button) {
    if (!window.confirm("Archive this delivery? It will leave the active list but remain in the exported log.")) {
        return;
    }

    deliveryMessage.hidden = true;
    button.disabled = true;
    try {
        await requestJson(apiUrl("deliveries", { id }), { method: "DELETE" });
        await loadDashboard();
        deliveryMessage.textContent = "Delivery archived. It remains available in the exported log.";
        deliveryMessage.hidden = false;
    } catch (error) {
        deliveryMessage.textContent = error.message;
        deliveryMessage.hidden = false;
        button.disabled = false;
    }
}

deliveryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    formMessage.hidden = true;

    if (!deliveryForm.reportValidity()) {
        return;
    }
    if (!currentRate) {
        formMessage.textContent = "Choose a location and truck length with an active rate.";
        formMessage.hidden = false;
        return;
    }

    const formData = new FormData(deliveryForm);
    const payload = {
        deliveryDate: formData.get("date"),
        drNumber: formData.get("drNumber"),
        truckPlate: formData.get("truckPlate"),
        customerName: formData.get("customerName"),
        destinationId: Number(destinationSelect.value),
        postLength: Number(lengthSelect.value)
    };

    submitButton.disabled = true;
    try {
        await runWithLoadingIndicator("Saving delivery...", () => requestJson(apiUrl("deliveries"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }));

        deliveryForm.reset();
        deliveryDate.value = localDate;
        updateRatePreview();
        await loadDashboard();
        document.querySelector("#dr-number").focus();
    } catch (error) {
        formMessage.textContent = error.message;
        formMessage.hidden = false;
        updateRatePreview();
    }
});

destinationSelect.addEventListener("change", updateRatePreview);
lengthSelect.addEventListener("change", updateRatePreview);

exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    try {
        const response = await runWithLoadingIndicator("Exporting delivery logs...", () => fetch(apiUrl("export")));
        if (!response.ok) {
            let payload = {};
            try {
                payload = await response.json();
            } catch {
                throw new Error("The export service returned an invalid response.");
            }
            throw new Error(payload.error || `Export failed (${response.status}).`);
        }

        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "tsp-delivery-logs.xlsx";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
        deliveryMessage.textContent = error.message;
        deliveryMessage.hidden = false;
    } finally {
        exportButton.disabled = false;
    }
});

loadDashboard();
