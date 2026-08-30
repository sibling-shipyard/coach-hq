/**
 * Shared Gemini model id for every server-side generateContent call (chat, template
 * adjust, post-sync coach-message).
 *
 * Dated ids (gemini-2.0-flash, then gemini-2.5-flash) kept getting cut early. Google's
 * "-latest" alias is the pin we keep.
 *
 * TODO: revert to gemini-flash-latest once flash stability is confirmed — temporarily
 * pinned to pro after flash 503/504 failures under real load (see #668).
 */
export const GEMINI_PRO = "gemini-pro-latest";
