const OVERRIDE_COLOR_SCHEME_KEY = "override-color-scheme";

function systemScheme() {
  if (window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  }
  return null;
}

function localStorageScheme() {
  const store = window.localStorage.getItem(OVERRIDE_COLOR_SCHEME_KEY);
  switch (store) {
  case "dark":
    return "dark";
  case "light":
    return "light";
  default:
    return null;
  }
}

function getEffectiveColorScheme() {
  const scheme = localStorageScheme();
  if (scheme) {
    return scheme;
  }
  return systemScheme() ?? "light";
}

function toggleDomStyles(toggle, scheme) {
  if (scheme == "dark") {
    toggle.classList.add("enabled");
    document.documentElement.classList.add("dark");
  } else {
    toggle.classList.remove("enabled");
    document.documentElement.classList.remove("dark");
  }
}

function init() {
  const toggle = document.getElementById("color-scheme-toggle");
  toggleDomStyles(toggle, getEffectiveColorScheme());
  toggle.style.display = "";

  toggle.addEventListener("click", () => {
    const toggledScheme = getEffectiveColorScheme() == "dark" ? "light" : "dark";
    window.localStorage.setItem(OVERRIDE_COLOR_SCHEME_KEY, toggledScheme);
    console.log(toggledScheme);
    toggleDomStyles(toggle, toggledScheme);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
    const newColorScheme = event.matches ? "dark" : "light";
    localStorage.removeItem(OVERRIDE_COLOR_SCHEME_KEY);
    toggleDomStyles(toggle, newColorScheme);
  });
}

// Prevent start-up flash bang.
if (getEffectiveColorScheme() == "dark") {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}

document.addEventListener("DOMContentLoaded", init);
