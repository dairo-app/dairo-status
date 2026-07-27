/** The honeypot field carried by every subscribe form (the header "Get updates" email tab and
 *  the MiniSubscribe re-subscribe forms). A submission that fills it is a bot, and the server
 *  silently drops it — see ../data/gate.ts.
 *
 *  Deliberately plain HTML with an inline style: no JavaScript, and no dependency on a
 *  Tailwind class surviving a CSS rebuild — if the stylesheet ever failed to load, a
 *  `class="hidden"` honeypot would become a visible field that real users would fill in.
 *
 *  Hidden three ways, because each covers a different visitor:
 *    - off-screen positioning hides it from anyone who can see the page;
 *    - `tabindex=-1` keeps it out of the keyboard tab order;
 *    - `aria-hidden` keeps screen readers from announcing it.
 *  `type="hidden"` would be simpler but is the one thing form-filling bots know to skip. */
import { HONEYPOT_FIELD } from "../data/gate";

const WRAP_STYLE =
  "position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden";

export function Honeypot() {
  return (
    <div aria-hidden="true" style={WRAP_STYLE}>
      <label for={`hp-${HONEYPOT_FIELD}`}>Leave this field empty</label>
      <input
        id={`hp-${HONEYPOT_FIELD}`}
        type="text"
        name={HONEYPOT_FIELD}
        value=""
        tabindex={-1}
        autocomplete="off"
      />
    </div>
  );
}
