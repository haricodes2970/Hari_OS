/**
 * Hari OS — first-time local installation.
 *
 * Run once, after cloning or updating the repository:
 *
 *     npm run setup:hari
 *
 * It does the four things that have to happen before the launcher can work, in order, and
 * stops at the first failure rather than continuing past one. There is nothing to configure
 * and nothing to answer: no prompts, no secrets, no network calls beyond `npm ci` reading the
 * registry for the packages `package-lock.json` already pins.
 *
 *   1. `npm ci`            — dependencies, exactly as the lockfile records them.
 *   2. `npm run build`     — the production build the launcher refuses to run without.
 *   3. `npm run db:setup`  — first-run rows: the three PRD accounts.
 *   4. desktop entries     — so Hari OS appears in the applications menu and on the Desktop.
 *
 * Steps 1–3 are the project's own scripts; this file only runs them in order and reports
 * honestly what happened. It contains no application logic, because there is none to contain.
 *
 * Node.js 20.9 or newer must already be installed. This script does not download it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Runs a command, inheriting this terminal's stdio so the user sees everything it prints. */
function run(label, command, args) {
  process.stdout.write(`\n=== ${label} ===\n`);

  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    return { ok: false, reason: result.error.message };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      reason: `${command} exited with status ${result.status}`,
    };
  }

  return { ok: true };
}

/**
 * Whether this machine has a graphical desktop that can show an application launcher.
 *
 * A headless machine, a container, or a plain SSH session gets no `.desktop` files. That is
 * not a failure — `npm run launch:hari` works identically from a terminal there — so it is
 * reported and skipped rather than treated as an error.
 */
function desktopAvailable() {
  return (
    os.platform() === "linux" &&
    Boolean(process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION)
  );
}

/**
 * Writes the two launcher entries: one in the applications menu, one on the Desktop.
 *
 * Both point at `start-hari.sh` with the project's absolute path baked in, because `.desktop`
 * files cannot resolve a relative path and are read by the desktop shell rather than by a
 * shell. `TryExec` is set so the menu greys the entry out rather than failing if the project
 * is moved or deleted.
 */
function installDesktopEntries() {
  const launcher = path.join(projectRoot, "scripts", "start-hari.sh");
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Hari OS",
    "Comment=Hari OS — your personal operating system, on localhost",
    `Exec=bash "${launcher}"`,
    `TryExec=bash`,
    "Path=" + projectRoot,
    "Terminal=false",
    // GNOME refuses to run a .desktop file that is not marked trusted. Marking it trusted
    // here is what lets the Desktop icon be double-clicked with no further ceremony.
    "X-GNOME-Autostart-enabled=true",
    "Categories=Utility;",
    "StartupNotify=true",
    "",
  ].join("\n");

  const targets = [];

  const appsDir = path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "applications",
  );

  targets.push(path.join(appsDir, "hari-os.desktop"));

  const desktopDir = path.join(os.homedir(), "Desktop");

  if (fs.existsSync(desktopDir)) {
    targets.push(path.join(desktopDir, "Hari OS.desktop"));
  }

  const written = [];

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry, { mode: 0o755 });
    written.push(target);
  }

  // GNOME tracks trust in the user's own dconf database rather than in the file. Asking it
  // directly is the supported route and needs no extra tooling on the machine. If `gio` is
  // absent the entry still appears; the user can trust it by hand from the file's menu.
  spawnSync("gio", ["set", `metadata::${targets[0]}`, "trusted", "true"], {
    stdio: "ignore",
  });

  return { written };
}

console.log("Hari OS — local installation");
console.log(`Project: ${projectRoot}`);
console.log(`Node:    ${process.version}`);

const minimumMajor = 20;

if (Number(process.versions.node.split(".")[0]) < minimumMajor) {
  console.error(
    `\nNode.js ${minimumMajor} or newer is required. This is ${process.version}.`,
  );
  console.error(
    "Install a newer Node.js, then run this again. Nothing was changed.",
  );
  process.exit(1);
}

const ci = run("1/4  Install dependencies (npm ci)", "npm", ["ci"]);

if (!ci.ok) {
  console.error(`\nInstallation stopped: ${ci.reason}`);
  process.exit(1);
}

const build = run("2/4  Production build (next build)", "npm", [
  "run",
  "build",
]);

if (!build.ok) {
  console.error(`\nInstallation stopped: ${build.reason}`);
  console.error(
    "The build failed, so no launcher was installed. Nothing was changed.",
  );
  process.exit(1);
}

const setup = run("3/4  First-run rows (db:setup)", "npm", ["run", "db:setup"]);

if (!setup.ok) {
  console.error(`\nInstallation stopped: ${setup.reason}`);
  process.exit(1);
}

console.log("\n=== 4/4  Launcher entries ===");

if (desktopAvailable()) {
  try {
    const { written } = installDesktopEntries();
    console.log("Installed:");
    for (const file of written) {
      console.log(`  ${file}`);
    }
    console.log(
      "\nIf the Desktop icon does not open on the first double-click, right-click it and",
    );
    console.log(
      'choose "Allow Launching". That is a one-time GNOME trust prompt.',
    );
  } catch (error) {
    console.error(`Could not write the desktop entries: ${error.message}`);
    console.error(
      "Nothing else was affected. `npm run launch:hari` still works.",
    );
  }
} else {
  console.log(
    "No graphical desktop detected, so no desktop entries were written.",
  );
  console.log("That is fine — start Hari OS with:  npm run launch:hari");
}

console.log("\nInstallation complete.");
console.log("\n  Start Hari OS:   npm run launch:hari");
console.log("  Or click Hari OS in your applications menu.");
console.log("  Then open:       http://localhost:6377");
console.log("  Stop Hari OS:    npm run stop:hari");
