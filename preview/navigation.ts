export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
export function usePathname() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}
