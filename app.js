const deliveryForm = document.querySelector("#delivery-form");
const deliveryDate = document.querySelector("#delivery-date");
const todayLabel = document.querySelector("#today-label");
const deliveryList = document.querySelector("#delivery-list");
const deliveryCountLabel = document.querySelector("#delivery-count");
const emptyState = document.querySelector("#empty-state");
const loadingOverlay = document.querySelector("#loading-overlay");
const loadingMessage = document.querySelector("#loading-message");
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
});

const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

deliveryDate.value = localDate;
todayLabel.textContent = dateFormatter.format(today);
document.querySelector("#current-year").textContent = String(today.getFullYear());

let deliveryCount = 0;
const activeLoadingTasks = new Set();

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

if (document.readyState !== "complete") {
    const stopPageLoading = startLoading("Loading TSP Logistics...");
    window.addEventListener("load", stopPageLoading, { once: true });
}

function appendDetail(details, label, value) {
    const field = document.createElement("div");
    field.className = "delivery-field";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value;

    field.append(term, description);
    details.append(field);
}

deliveryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!deliveryForm.reportValidity()) {
        return;
    }

    await runWithLoadingIndicator("Adding delivery...", () => {
        const formData = new FormData(deliveryForm);
        const shipment = Object.fromEntries(formData.entries());
        const formattedDate = dateFormatter.format(new Date(`${shipment.date}T00:00:00`));
        const drNumber = shipment.drNumber.trim();

        deliveryCount += 1;

        const delivery = document.createElement("article");
        delivery.className = "delivery-item";
        delivery.setAttribute("aria-label", `Delivery ${deliveryCount}: ${drNumber}`);

        const header = document.createElement("div");
        header.className = "delivery-item-top";

        const titleGroup = document.createElement("div");
        titleGroup.className = "delivery-title-group";

        const index = document.createElement("span");
        index.className = "delivery-index";
        index.textContent = `DELIVERY ${String(deliveryCount).padStart(2, "0")}`;

        const title = document.createElement("h3");
        title.textContent = drNumber;
        titleGroup.append(index, title);

        const rateStatus = document.createElement("span");
        rateStatus.className = "delivery-rate-status";
        const statusDot = document.createElement("span");
        statusDot.className = "status-dot";
        statusDot.setAttribute("aria-hidden", "true");
        rateStatus.append(statusDot, document.createTextNode("Rate pending"));

        header.append(titleGroup, rateStatus);

        const details = document.createElement("dl");
        details.className = "delivery-details";
        appendDetail(details, "Delivery date", formattedDate);
        appendDetail(details, "Truck plate", shipment.truckPlate.trim());
        appendDetail(details, "Customer", shipment.customerName.trim());
        appendDetail(details, "Destination", shipment.destination.trim());
        appendDetail(details, "Rate", "Pending TiDB connection");

        delivery.append(header, details);
        deliveryList.append(delivery);
        emptyState.hidden = true;
        deliveryCountLabel.textContent = `${deliveryCount} ${deliveryCount === 1 ? "delivery" : "deliveries"}`;

        deliveryForm.reset();
        deliveryDate.value = localDate;
        document.querySelector("#dr-number").focus();
    });
});
