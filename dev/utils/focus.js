/** The element that really has keyboard focus, looking through shadow roots. */
export function deepActiveElement(root = document) {
    let active = root.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active || null;
}
