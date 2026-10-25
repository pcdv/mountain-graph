// From web-lib (https://github.com/pcdv/web-lib), src/tip.ts: changed there, then synced here.
/** What a tip offers beyond its message. */
export interface More {
    /** what the button says: "More…" when not given */
    label?: string;
    /** called when it is clicked, once the message is hidden */
    open: () => void;
}
/**
 * Gives an element a tip.
 *
 * @param el what shows it, hovered or focused: the label of a control, or the control
 * @param message what the control does, in a sentence or two
 * @param more a button to more help, none if the message says it all
 * @returns el
 */
export declare function tip<T extends HTMLElement>(el: T, message: string | Node, more?: More): T;
/** Hides the message shown, if any. */
export declare function hideTip(): void;
