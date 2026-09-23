export interface MenuAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}
let dismiss: (() => void) | undefined;
export const closeMenu = () => dismiss?.();
export function contextMenu(
  x: number,
  y: number,
  title: string,
  actions: MenuAction[],
) {
  closeMenu();
  const original = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "context-menu";
  dialog.setAttribute("aria-label", title);
  const heading = document.createElement("strong");
  heading.textContent = title;
  dialog.append(heading);
  const list = document.createElement("div");
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", title);
  dialog.append(list);
  const close = () => {
    dialog.close();
    dialog.remove();
    if (dismiss === close) dismiss = undefined;
    if (original?.isConnected) original.focus({ preventScroll: true });
  };
  dismiss = close;
  for (const a of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = a.label;
    button.setAttribute("role", "menuitem");
    button.disabled = !!a.disabled;
    if (a.danger) button.className = "danger";
    button.onclick = () => {
      close();
      a.run();
    };
    list.append(button);
  }
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener("click", (e) => {
    const b = dialog.getBoundingClientRect();
    if (
      e.target === dialog &&
      (e.clientX < b.left ||
        e.clientX > b.right ||
        e.clientY < b.top ||
        e.clientY > b.bottom)
    )
      close();
  });
  dialog.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = [
      ...list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    if (!items.length) return;
    let i = items.indexOf(document.activeElement as HTMLButtonElement);
    i =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[i].focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.style.left = `${Math.max(8, Math.min(x, innerWidth - dialog.offsetWidth - 8))}px`;
  dialog.style.top = `${Math.max(8, Math.min(y, innerHeight - dialog.offsetHeight - 8))}px`;
  list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
