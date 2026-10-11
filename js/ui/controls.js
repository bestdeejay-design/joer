/**
 * JOER — клавиатурная навигация по табам групп (T-04).
 *
 * Рендер пересоздаёт кнопки, поэтому навигация живёт на контейнере:
 * стрелки/Home/End переносят фокус и сразу выбирают группу.
 */
export function setupRovingTabs(container, { onNavigate } = {}) {
  container.addEventListener("keydown", (event) => {
    const tabs = [...container.querySelectorAll(".group-tab")];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;

    let next = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const tab = tabs[next];
    tab.focus();
    onNavigate?.(tab.dataset.groupId);
  });
}

/** Вернуть фокус на таб после перерендера (иначе клавиатура «теряется»). */
export function restoreTabFocus(container, groupId) {
  if (!groupId) return;
  const tab = [...container.querySelectorAll(".group-tab")].find((item) => item.dataset.groupId === groupId);
  tab?.focus();
}
