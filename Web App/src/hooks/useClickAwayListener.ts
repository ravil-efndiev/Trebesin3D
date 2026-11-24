import { type RefObject, useEffect } from "react";

const useClickAwayListener = <
  ClickAwayFromT extends HTMLElement,
  ParentElementT extends HTMLElement,
>(
  ref: RefObject<ClickAwayFromT | null>,
  onClickAway: () => void,
  onlyWorksInside?: RefObject<ParentElementT | null>,
) => {
  useEffect(() => {
    const clickEventListener = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !ref.current?.contains(target) &&
        (!onlyWorksInside || onlyWorksInside.current?.contains(target))
      ) {
        onClickAway();
      }
    };

    window.addEventListener("click", clickEventListener);

    return () => window.removeEventListener("click", clickEventListener);
  }, []);
};

export default useClickAwayListener;
