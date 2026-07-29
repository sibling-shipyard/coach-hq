from __future__ import annotations

import json
import math
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from selenium import webdriver
from selenium.webdriver import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL = "http://127.0.0.1:3001"
OUTPUT_DIR = Path(__file__).parent / "validation-assets"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PROTECTED_HOME_PATH = "/"
V2_ROUTE_NAME = "home"
V2_PATH = "/"
VIEWPORTS = (390, 720, 1024, 1440)


def chrome_options(*, touch: bool = False) -> Options:
    options = Options()
    options.binary_location = "/usr/bin/chromium"
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-proxy-server")
    options.add_argument("--force-device-scale-factor=1")
    if touch:
        options.add_experimental_option(
            "mobileEmulation",
            {
                "deviceMetrics": {
                    "width": 390,
                    "height": 844,
                    "pixelRatio": 1,
                    "touch": True,
                    "mobile": True,
                },
                "userAgent": (
                    "Mozilla/5.0 (Linux; Android 14; Pixel 8) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Mobile Safari/537.36"
                ),
            },
        )
    return options


def open_page(
    driver: webdriver.Chrome,
    path: str,
    width: int = 1440,
    height: int = 1100,
    wait_selector: str = ".wi-shell",
) -> None:
    if not driver.execute_script("return /Android/.test(navigator.userAgent)"):
        driver.set_window_size(width, height)
    driver.get(f"{BASE_URL}{path}")
    WebDriverWait(driver, 20).until(lambda current: current.find_elements(By.CSS_SELECTOR, wait_selector))
    time.sleep(0.25)


def rendered_all(driver: webdriver.Chrome, selector: str) -> list[WebElement]:
    result: list[WebElement] = []
    for element in driver.find_elements(By.CSS_SELECTOR, selector):
        box = driver.execute_script(
            "const r=arguments[0].getBoundingClientRect(); return {w:r.width,h:r.height};",
            element,
        )
        if box["w"] > 0 and box["h"] > 0:
            result.append(element)
    return result


def rendered(driver: webdriver.Chrome, selector: str) -> WebElement:
    elements = rendered_all(driver, selector)
    if not elements:
        raise AssertionError(f"No rendered element for {selector}")
    return elements[0]


def rect(driver: webdriver.Chrome, element: WebElement) -> dict[str, float]:
    return driver.execute_script(
        """
        const r=arguments[0].getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
        """,
        element,
    )


def rect_delta(before: dict[str, float], after: dict[str, float]) -> float:
    return round(max(abs(before[key] - after[key]) for key in ("x", "y", "width", "height")), 4)


def overflow_state(driver: webdriver.Chrome) -> dict[str, Any]:
    return driver.execute_script(
        """
        const root=document.documentElement;
        return {
          innerWidth:window.innerWidth,
          clientWidth:root.clientWidth,
          scrollWidth:root.scrollWidth,
          overflow:root.scrollWidth > root.clientWidth + 1,
        };
        """
    )


def pointer_move(driver: webdriver.Chrome, element: WebElement, fraction: float = 0.5) -> None:
    driver.execute_script(
        """
        const element=arguments[0];
        const fraction=arguments[1];
        const r=element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent('mousemove', {
          bubbles:true,
          cancelable:true,
          clientX:r.left + r.width * fraction,
          clientY:r.top + r.height * 0.5,
          view:window,
        }));
        """,
        element,
        fraction,
    )


def pointer_leave(driver: webdriver.Chrome, element: WebElement) -> None:
    driver.execute_script(
        """
        arguments[0].dispatchEvent(new MouseEvent('mouseout', {
          bubbles:true,
          cancelable:true,
          relatedTarget:document.body,
          view:window,
        }));
        """,
        element,
    )


def wait_for_count(driver: webdriver.Chrome, selector: str, expected: int) -> None:
    WebDriverWait(driver, 5).until(lambda current: len(rendered_all(current, selector)) == expected)


def record_check(report: dict[str, Any], condition: bool, code: str, details: Any = None) -> None:
    report.setdefault("checks", []).append({"code": code, "passed": bool(condition), "details": details})
    if not condition:
        report.setdefault("failures", []).append({"code": code, "details": details})


def static_glance_state(driver: webdriver.Chrome) -> dict[str, Any]:
    selectors = {
        "quest": ".wi-quest-card",
        "commitments": ".wi-commitment-card",
        "coachRead": ".wi-coach-read-card",
        "sessions": ".wi-session-row",
    }
    return {
        name: driver.execute_script(
            """
            return [...document.querySelectorAll(arguments[0])].reduce((sum, root) =>
              sum + root.querySelectorAll('button,[role="button"],[tabindex]:not([tabindex="-1"])').length, 0);
            """,
            selector,
        )
        for name, selector in selectors.items()
    }


def engine_scrub_check(driver: webdriver.Chrome, route: str) -> dict[str, Any]:
    card = rendered(driver, ".wi-engine-card")
    scrub = rendered(driver, '[data-wi-scrub="engine"]')
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", card)
    before_card = rect(driver, card)
    before_scrub = rect(driver, scrub)
    pointer_move(driver, scrub, 0.54)
    wait_for_count(driver, ".wi-engine-card .wi-trend-scrub__chip", 1)
    active = rendered(driver, ".wi-engine-card .wi-trend-scrub__chip")
    active_text = active.text.strip()
    active_index = driver.execute_script(
        "return arguments[0].querySelector('[data-wi-scrub-index]')?.getAttribute('data-wi-scrub-index');",
        card,
    )
    after_card = rect(driver, card)
    after_scrub = rect(driver, scrub)
    driver.save_screenshot(str(OUTPUT_DIR / f"{route}-engine-scrub.png"))
    pointer_leave(driver, scrub)
    wait_for_count(driver, ".wi-engine-card .wi-trend-scrub__chip", 0)
    driver.execute_script(
        "arguments[0].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));",
        scrub,
    )
    time.sleep(0.08)
    click_persisted = bool(rendered_all(driver, ".wi-engine-card .wi-trend-scrub__chip"))
    return {
        "chipText": active_text,
        "scrubIndex": active_index,
        "cardDeltaPx": rect_delta(before_card, after_card),
        "scrubDeltaPx": rect_delta(before_scrub, after_scrub),
        "clearedOnLeave": not bool(rendered_all(driver, ".wi-engine-card .wi-trend-scrub__chip")),
        "clickPersisted": click_persisted,
        "role": scrub.get_attribute("role"),
        "tabIndex": scrub.get_attribute("tabindex"),
    }


def calories_scrub_check(driver: webdriver.Chrome, route: str) -> dict[str, Any]:
    card = rendered(driver, ".wi-calories-card")
    meter = rendered(driver, '[data-wi-scrub="calories"]')
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", card)
    before = rect(driver, card)
    pointer_move(driver, meter, 0.62)
    wait_for_count(driver, ".wi-calories-card__hover", 1)
    chip = rendered(driver, ".wi-calories-card__hover")
    chip_rect = rect(driver, chip)
    card_rect = rect(driver, card)
    data = {
        "text": chip.text.strip(),
        "day": chip.get_attribute("data-wi-calories-day"),
        "contained": (
            chip_rect["x"] >= card_rect["x"] - 1
            and chip_rect["right"] <= card_rect["right"] + 1
            and chip_rect["y"] >= card_rect["y"] - 1
            and chip_rect["bottom"] <= card_rect["bottom"] + 1
        ),
        "cardDeltaPx": rect_delta(before, rect(driver, card)),
    }
    driver.save_screenshot(str(OUTPUT_DIR / f"{route}-calories-scrub.png"))
    pointer_leave(driver, meter)
    wait_for_count(driver, ".wi-calories-card__hover", 0)
    data["clearedOnLeave"] = True
    return data


def plan_keyboard_check(driver: webdriver.Chrome, route: str) -> dict[str, Any]:
    card = rendered(driver, ".wi-plan-card")
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", card)
    time.sleep(0.08)
    slots = rendered_all(driver, ".wi-plan-day__slot")
    before_card = rect(driver, card)
    before_labels = [slot.get_attribute("aria-label") for slot in slots]
    source_index = next(index for index, slot in enumerate(slots) if slot.get_attribute("draggable") == "true")
    destination_index = min(source_index + 1, len(slots) - 1)
    source = slots[source_index]
    source.click()
    source.send_keys(Keys.ENTER)
    WebDriverWait(driver, 5).until(lambda current: source.get_attribute("aria-pressed") == "true")
    source.send_keys(Keys.ARROW_RIGHT)
    active = driver.switch_to.active_element
    active.send_keys(Keys.ENTER)
    WebDriverWait(driver, 5).until(
        lambda current: all(slot.get_attribute("aria-pressed") == "false" for slot in rendered_all(current, ".wi-plan-day__slot"))
    )
    after_slots = rendered_all(driver, ".wi-plan-day__slot")
    after_labels = [slot.get_attribute("aria-label") for slot in after_slots]
    status = rendered(driver, ".wi-plan-card__projection").text.strip()
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", card)
    time.sleep(0.08)
    driver.save_screenshot(str(OUTPUT_DIR / f"{route}-plan-keyboard-swap.png"))
    return {
        "sourceIndex": source_index,
        "destinationIndex": destination_index,
        "beforeLabels": before_labels,
        "afterLabels": after_labels,
        "swapped": (
            before_labels[source_index].split(": ", 1)[1] == after_labels[destination_index].split(": ", 1)[1]
            and before_labels[destination_index].split(": ", 1)[1] == after_labels[source_index].split(": ", 1)[1]
        ),
        "status": status,
        "cardDeltaPx": rect_delta(before_card, rect(driver, card)),
    }


def plan_drag_check(driver: webdriver.Chrome) -> dict[str, Any]:
    card = rendered(driver, ".wi-plan-card")
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", card)
    time.sleep(0.08)
    slots = rendered_all(driver, ".wi-plan-day__slot")
    before_card = rect(driver, card)
    before_labels = [slot.get_attribute("aria-label") for slot in slots]
    source_index = next(index for index, slot in enumerate(slots) if slot.get_attribute("draggable") == "true")
    destination_index = min(source_index + 1, len(slots) - 1)
    driver.execute_script(
        """
        const source=arguments[0];
        const target=arguments[1];
        const transfer=new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        source.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        """,
        slots[source_index],
        slots[destination_index],
    )
    time.sleep(0.12)
    after_labels = [slot.get_attribute("aria-label") for slot in rendered_all(driver, ".wi-plan-day__slot")]
    return {
        "sourceIndex": source_index,
        "destinationIndex": destination_index,
        "swapped": (
            before_labels[source_index].split(": ", 1)[1] == after_labels[destination_index].split(": ", 1)[1]
            and before_labels[destination_index].split(": ", 1)[1] == after_labels[source_index].split(": ", 1)[1]
        ),
        "cardDeltaPx": rect_delta(before_card, rect(driver, card)),
        "status": rendered(driver, ".wi-plan-card__projection").text.strip(),
    }


def heatmap_paging_check(driver: webdriver.Chrome, route: str) -> dict[str, Any]:
    card = rendered(driver, ".wi-training-card")
    window = rendered(driver, "[data-wi-month-window]")
    buttons = rendered_all(driver, ".wi-training-card__paging button")
    before_card = rect(driver, card)
    initial = window.get_attribute("data-wi-month-window")
    month_count = len(rendered_all(driver, ".wi-activity-month"))
    previous, following = buttons
    previous.click()
    WebDriverWait(driver, 5).until(
        lambda current: rendered(current, "[data-wi-month-window]").get_attribute("data-wi-month-window") != initial
    )
    previous_range = rendered(driver, "[data-wi-month-window]").get_attribute("data-wi-month-window")
    following = rendered_all(driver, ".wi-training-card__paging button")[1]
    following.click()
    WebDriverWait(driver, 5).until(
        lambda current: rendered(current, "[data-wi-month-window]").get_attribute("data-wi-month-window") == initial
    )
    driver.save_screenshot(str(OUTPUT_DIR / f"{route}-heatmap-paged.png"))
    return {
        "initialRange": initial,
        "previousRange": previous_range,
        "returnedToInitial": rendered(driver, "[data-wi-month-window]").get_attribute("data-wi-month-window") == initial,
        "visibleMonthCount": month_count,
        "cardDeltaPx": rect_delta(before_card, rect(driver, card)),
    }


def build_hover_check(driver: webdriver.Chrome, route: str) -> dict[str, Any]:
    card = rendered(driver, ".wi-build-card")
    row = rendered(driver, ".wi-build-card__milestone")
    badge = rendered(driver, ".wi-build-card__badge")
    peer = rendered(driver, ".wi-sessions-card")
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", row)
    before_card = rect(driver, card)
    before_peer = rect(driver, peer)
    ActionChains(driver).move_to_element(row).pause(0.18).perform()
    style = driver.execute_script(
        "const s=getComputedStyle(arguments[0]); return {opacity:Number(s.opacity),visibility:s.visibility};",
        badge,
    )
    badge_rect = rect(driver, badge)
    viewport = driver.execute_script("return {width:innerWidth,height:innerHeight};")
    result = {
        "badgeText": badge.text.strip(),
        "badgeVisible": style["opacity"] > 0.99 and style["visibility"] == "visible",
        "badgeInsideViewport": (
            badge_rect["x"] >= 0
            and badge_rect["right"] <= viewport["width"] + 1
            and badge_rect["y"] >= 0
            and badge_rect["bottom"] <= viewport["height"] + 1
        ),
        "cardVisualLiftPx": round(before_card["y"] - rect(driver, card)["y"], 4),
        "peerDeltaPx": rect_delta(before_peer, rect(driver, peer)),
    }
    driver.save_screenshot(str(OUTPUT_DIR / f"{route}-build-hover.png"))
    ActionChains(driver).move_to_element(rendered(driver, ".wi-instrument-header__brand")).perform()
    time.sleep(0.12)
    result["clearedOnLeave"] = driver.execute_script("return Number(getComputedStyle(arguments[0]).opacity) === 0;", badge)
    return result


def desktop_route_checks(driver: webdriver.Chrome, route_name: str, path: str, report: dict[str, Any]) -> dict[str, Any]:
    open_page(driver, path, 1440, 1000)
    ActionChains(driver).move_to_element(rendered(driver, ".wi-instrument-header__brand")).perform()
    driver.refresh()
    WebDriverWait(driver, 20).until(lambda current: current.find_elements(By.CSS_SELECTOR, ".wi-shell"))
    WebDriverWait(driver, 5).until(
        lambda current: not current.find_elements(By.CSS_SELECTOR, ".wi-engine-trend [data-wi-scrub-index]")
    )
    time.sleep(0.25)
    static_state = static_glance_state(driver)
    legacy_count = driver.execute_script(
        "return document.querySelectorAll('[data-wi-annotation-mark],.wi-mark-annotation').length;"
    )
    all_text = rendered(driver, ".wi-commitment-card.is-badminton .wi-commitment-card__meta").text
    engine = engine_scrub_check(driver, route_name)
    calories = calories_scrub_check(driver, route_name)
    heatmap = heatmap_paging_check(driver, route_name)
    build = build_hover_check(driver, route_name)
    session_url = driver.current_url
    session = rendered(driver, ".wi-session-row")
    driver.execute_script("arguments[0].click();", session)
    session_state = {
        "tag": session.tag_name,
        "role": session.get_attribute("role"),
        "tabIndex": session.get_attribute("tabindex"),
        "urlUnchanged": driver.current_url == session_url,
        "allActivityHref": rendered(driver, ".wi-sessions-card .wi-card-kicker a").get_attribute("href"),
    }
    plan_keyboard = plan_keyboard_check(driver, route_name)

    open_page(driver, path, 1440, 1000)
    plan_drag = plan_drag_check(driver)

    vo2_state = {
        "available": bool(rendered_all(driver, '.wi-vo2-card:not(.is-unavailable)')),
        "scrubCount": len(rendered_all(driver, '[data-wi-scrub="vo2"]')),
        "interactiveCountWhenUnavailable": driver.execute_script(
            "return document.querySelectorAll('.wi-vo2-card.is-unavailable button,.wi-vo2-card.is-unavailable [role=" + '"button"' + "]').length;"
        ),
    }
    result = {
        "staticGlances": static_state,
        "legacyAnnotationCount": legacy_count,
        "badmintonMeta": all_text.strip(),
        "engine": engine,
        "calories": calories,
        "heatmap": heatmap,
        "build": build,
        "sessions": session_state,
        "planKeyboard": plan_keyboard,
        "planDrag": plan_drag,
        "vo2": vo2_state,
    }

    record_check(report, all(value == 0 for value in static_state.values()), f"{route_name}.static_glances", static_state)
    record_check(report, legacy_count == 0, f"{route_name}.no_legacy_annotations", legacy_count)
    record_check(report, "ALL" in all_text and "⇄" not in all_text, f"{route_name}.fixed_all_record", all_text.strip())
    record_check(report, bool(engine["chipText"]) and engine["cardDeltaPx"] == 0 and not engine["clickPersisted"], f"{route_name}.engine_scrub", engine)
    record_check(report, engine["role"] == "img" and engine["tabIndex"] is None, f"{route_name}.engine_not_false_button", engine)
    record_check(report, calories["contained"] and calories["cardDeltaPx"] == 0 and calories["clearedOnLeave"], f"{route_name}.calories_scrub", calories)
    record_check(report, heatmap["previousRange"] != heatmap["initialRange"] and heatmap["returnedToInitial"] and heatmap["cardDeltaPx"] == 0, f"{route_name}.heatmap_paging", heatmap)
    record_check(report, build["badgeVisible"] and build["peerDeltaPx"] == 0 and build["clearedOnLeave"], f"{route_name}.build_hover", build)
    record_check(report, session_state["urlUnchanged"] and session_state["role"] is None and session_state["tabIndex"] is None, f"{route_name}.sessions_inert", session_state)
    record_check(report, plan_keyboard["swapped"] and plan_keyboard["cardDeltaPx"] == 0, f"{route_name}.plan_keyboard_swap", plan_keyboard)
    record_check(report, plan_drag["swapped"] and plan_drag["cardDeltaPx"] == 0, f"{route_name}.plan_drag_swap", plan_drag)
    record_check(report, vo2_state["available"] or (vo2_state["scrubCount"] == 0 and vo2_state["interactiveCountWhenUnavailable"] == 0), f"{route_name}.vo2_unavailable_inert", vo2_state)
    return result


def touch_route_checks(driver: webdriver.Chrome, route_name: str, path: str, report: dict[str, Any]) -> dict[str, Any]:
    open_page(driver, path, 390, 844)
    media = driver.execute_script(
        "return {fineHover:matchMedia('(hover: hover) and (pointer: fine)').matches, coarse:matchMedia('(pointer: coarse)').matches};"
    )
    engine = rendered(driver, '[data-wi-scrub="engine"]')
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", engine)
    driver.execute_script(
        """
        const element=arguments[0];
        const r=element.getBoundingClientRect();
        element.dispatchEvent(new PointerEvent('pointermove', {
          bubbles:true,pointerType:'touch',clientX:r.left+r.width/2,clientY:r.top+r.height/2
        }));
        element.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles:true,pointerType:'touch',clientX:r.left+r.width/2,clientY:r.top+r.height/2
        }));
        element.dispatchEvent(new PointerEvent('pointerup', {
          bubbles:true,pointerType:'touch',clientX:r.left+r.width/2,clientY:r.top+r.height/2
        }));
        """,
        engine,
    )
    time.sleep(0.1)
    engine_chip_count = len(rendered_all(driver, ".wi-engine-card .wi-trend-scrub__chip"))

    calories_chip_count = 0
    if rendered_all(driver, '[data-wi-scrub="calories"]'):
        meter = rendered(driver, '[data-wi-scrub="calories"]')
        driver.execute_script(
            "arguments[0].dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch'}));",
            meter,
        )
        time.sleep(0.08)
        calories_chip_count = len(rendered_all(driver, ".wi-calories-card__hover"))

    milestone = rendered(driver, ".wi-build-card__milestone")
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", milestone)
    driver.execute_script("arguments[0].click();", milestone)
    badge_opacity = driver.execute_script(
        "return Number(getComputedStyle(arguments[0]).opacity);",
        rendered(driver, ".wi-build-card__badge"),
    )

    slots = rendered_all(driver, ".wi-plan-day__slot")
    before_labels = [slot.get_attribute("aria-label") for slot in slots]
    first_draggable = next(slot for slot in slots if slot.get_attribute("draggable") == "true")
    driver.execute_script("arguments[0].click();", first_draggable)
    time.sleep(0.08)
    after_labels = [slot.get_attribute("aria-label") for slot in rendered_all(driver, ".wi-plan-day__slot")]

    state = {
        "media": media,
        "engineChipCountAfterTouch": engine_chip_count,
        "caloriesChipCountAfterTouch": calories_chip_count,
        "buildBadgeOpacityAfterTap": badge_opacity,
        "planUnchangedAfterTap": before_labels == after_labels,
        "overflow": overflow_state(driver),
        "trainingRendered": bool(rendered_all(driver, ".wi-training-card")),
        "vo2Rendered": bool(rendered_all(driver, ".wi-vo2-card")),
        "legacyAnnotationCount": driver.execute_script(
            "return document.querySelectorAll('[data-wi-annotation-mark],.wi-mark-annotation').length;"
        ),
    }
    driver.save_screenshot(str(OUTPUT_DIR / f"{route_name}-touch-rest.png"))
    record_check(report, not media["fineHover"] and media["coarse"], f"{route_name}.touch_media", media)
    record_check(report, engine_chip_count == 0 and calories_chip_count == 0 and badge_opacity == 0, f"{route_name}.touch_no_hover_disclosure", state)
    record_check(report, state["planUnchangedAfterTap"], f"{route_name}.touch_no_accidental_plan_move", state)
    record_check(report, not state["overflow"]["overflow"], f"{route_name}.touch_no_overflow", state["overflow"])
    return state


def reduced_motion_check(driver: webdriver.Chrome, report: dict[str, Any]) -> dict[str, Any]:
    driver.execute_cdp_cmd(
        "Emulation.setEmulatedMedia",
        {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]},
    )
    open_page(driver, V2_PATH, 1440, 1000)
    state = driver.execute_script(
        """
        const selectors=['.wi-engine-card','.wi-calories-card','.wi-build-card','.wi-plan-day__slot[draggable="true"]','.wi-build-card__badge'];
        return Object.fromEntries(selectors.map(selector => {
          const element=document.querySelector(selector);
          return [selector, element ? getComputedStyle(element).transitionDuration : null];
        }));
        """
    )
    passed = all(value in ("0s", None) for value in state.values())
    record_check(report, passed, "reduced_motion.transitions_removed", state)
    driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": []})
    return state


# In the coach-phelps-hq (sibling-shipyard) UI v2 migration, the old neo-brutalist "/" page was
# deleted outright rather than kept alongside the new one under /v2 - the Warm Instrument UI is
# now the only "/" there is. This check (originally verifying old and new UIs stayed isolated
# from each other's styling) no longer has anything to isolate against, so it's disabled here
# rather than left silently asserting something that's no longer true. Kept for reference in
# case a future version of this repo reintroduces a route split.
def protected_home_isolation_check(driver: webdriver.Chrome, report: dict[str, Any]) -> dict[str, Any] | None:
    return None


def generated_current_week_zone_load() -> dict[str, Any]:
    activities_path = Path(__file__).parents[2] / "shared/golden-dataset/repo-data/activities.json"
    activities = json.loads(activities_path.read_text(encoding="utf-8"))
    today = datetime.now().date()
    monday = today - timedelta(days=today.weekday())
    following_monday = monday + timedelta(days=7)
    weighted_seconds = 0.0
    observed_count = 0
    missing_zone_activity_ids: list[Any] = []

    for activity in activities:
        raw_date = activity.get("start_date_local")
        if not raw_date:
            continue
        activity_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
        if not monday <= activity_date < following_monday:
            continue

        zones = activity.get("hr_zones")
        activity_observed_seconds = 0.0
        activity_weighted_seconds = 0.0
        if zones:
            for weight in range(1, 6):
                seconds = max(0.0, float(zones.get(f"Zone {weight}", {}).get("seconds", 0) or 0))
                activity_observed_seconds += seconds
                activity_weighted_seconds += seconds * weight

        if activity_observed_seconds > 0:
            observed_count += 1
            weighted_seconds += activity_weighted_seconds
        else:
            missing_zone_activity_ids.append(activity.get("id"))

    raw_load = weighted_seconds / 60
    return {
        "weekStart": monday.isoformat(),
        "rawLoad": round(raw_load, 4),
        "displayLoad": math.floor(raw_load + 0.5),
        "observedActivityCount": observed_count,
        "missingZoneActivityIds": missing_zone_activity_ids,
    }


def v2_real_data_check(driver: webdriver.Chrome, report: dict[str, Any]) -> dict[str, Any]:
    open_page(driver, V2_PATH, 1440, 1000)
    expected = generated_current_week_zone_load()
    displayed_text = rendered(driver, ".wi-engine-card__number strong").text.strip()
    method = rendered(driver, ".wi-engine-card__method").text.strip()
    state = {
        "path": driver.execute_script("return location.pathname;"),
        "displayedLoad": int(displayed_text),
        "method": method,
        "expected": expected,
        "warmInstrumentShellCount": len(rendered_all(driver, ".wi-shell")),
    }
    record_check(
        report,
        state["path"] == V2_PATH and state["warmInstrumentShellCount"] == 1,
        "routes.v2_isolated",
        state,
    )
    record_check(
        report,
        state["displayedLoad"] == expected["displayLoad"]
        and not expected["missingZoneActivityIds"]
        and "ZONE 1–5" in method,
        "data.v2_zone_load_matches_generated_feed",
        state,
    )
    return state


def main() -> None:
    report: dict[str, Any] = {
        "contract": "Isolated real-data Home V2 + Widget Design Philosophy + Widget Interactions prototype",
        "checks": [],
        "failures": [],
    }
    desktop_driver = webdriver.Chrome(options=chrome_options())
    touch_driver = webdriver.Chrome(options=chrome_options(touch=True))
    try:
        report["protectedHome"] = protected_home_isolation_check(desktop_driver, report)
        report["v2RealData"] = v2_real_data_check(desktop_driver, report)
        report["overflow"] = []
        for route_name, path, wait_selector in (
            (V2_ROUTE_NAME, V2_PATH, ".wi-shell"),
        ):
            for width in VIEWPORTS:
                open_page(desktop_driver, path, width, 1000, wait_selector)
                state = overflow_state(desktop_driver)
                report["overflow"].append({"route": route_name, "requestedWidth": width, **state})
                record_check(report, not state["overflow"], f"{route_name}.overflow.{width}", state)

        report["desktop"] = desktop_route_checks(
            desktop_driver,
            V2_ROUTE_NAME,
            V2_PATH,
            report,
        )
        report["touch"] = touch_route_checks(
            touch_driver,
            V2_ROUTE_NAME,
            V2_PATH,
            report,
        )
        report["reducedMotion"] = reduced_motion_check(desktop_driver, report)
    finally:
        desktop_driver.quit()
        touch_driver.quit()

    output = OUTPUT_DIR / "reference-interactions-report.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if report["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
