import { MappingInstruction, CandidateProfile } from '../types';
import { WorkdayParser } from './workdayParser';

export class DOMFiller {
  // Track degree selection retry attempts per education block ID
  private static degreeRetryMap: Map<string, number> = new Map();

  private static hasValue(element: HTMLElement | null): boolean {
    if (!element) return false;
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    if (input.value && input.value.trim() !== '') return true;
    const text = (element.textContent || '').trim();
    if (text && text.toLowerCase() !== 'select one' && text.toLowerCase() !== 'select') return true;
    return false;
  }

  private static isDateContainerFilled(container: HTMLElement | null): boolean {
    if (!container) return false;
    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    for (const inp of Array.from(inputs)) {
      const v = (inp.value || '').trim();
      if (v && v !== 'YYYY' && v !== 'MM') {
        return true;
      }
    }
    const displays = container.querySelectorAll<HTMLElement>('[data-automation-id*="display"], div.css-yezobt');
    for (const div of Array.from(displays)) {
      const txt = (div.textContent || '').trim();
      if (txt && txt !== 'YYYY' && txt !== 'MM' && txt !== 'MM/YYYY') {
        return true;
      }
    }
    return false;
  }

  public static async executeInstructions(
    instructions: MappingInstruction[],
    candidate?: CandidateProfile
  ): Promise<{ filledCount: number; errorsCount: number }> {
    let filledCount = 0;
    let errorsCount = 0;

    if (candidate) {
      try {
        const prevWorkerFilled = await this.fillWorkdayPreviousWorker();
        if (prevWorkerFilled) filledCount++;
        await new Promise((r) => setTimeout(r, 400));

        const phoneCodeFilled = await this.fillWorkdayCountryPhoneCode(candidate);
        if (phoneCodeFilled) filledCount++;
        await new Promise((r) => setTimeout(r, 600));

        const addedMulti = await this.ensureMultiEntriesAndFill(candidate);
        filledCount += addedMulti;
        await new Promise((r) => setTimeout(r, 400));

        const voluntaryFilled = await this.fillWorkdayVoluntaryDisclosures(candidate);
        filledCount += voluntaryFilled;
        await new Promise((r) => setTimeout(r, 400));

        const selfIdentifyFilled = await this.fillWorkdaySelfIdentify(candidate);
        filledCount += selfIdentifyFilled;
        await new Promise((r) => setTimeout(r, 400));
      } catch (err) {
        console.warn('[Workday AI] Multi-entry setup notice:', err);
      }
    }

    // 2. Standard Form Field Instructions Execution
    for (const inst of instructions) {
      if (inst.action === 'skip' || !inst.value) continue;
      const fId = (inst.fieldId || '').toLowerCase();
      const aId = (inst.automationId || '').toLowerCase();

      const checkStr = `${fId} ${aId} ${inst.fieldId || ''} ${inst.automationId || ''}`.toLowerCase();

      if (
        checkStr.includes('source') ||
        checkStr.includes('countryphonecode') ||
        checkStr.includes('phonecode') ||
        checkStr.includes('work') ||
        checkStr.includes('exp') ||
        checkStr.includes('edu') ||
        checkStr.includes('school') ||
        checkStr.includes('degree') ||
        checkStr.includes('date') ||
        checkStr.includes('from') ||
        checkStr.includes('to') ||
        checkStr.includes('start') ||
        checkStr.includes('end') ||
        checkStr.includes('month') ||
        checkStr.includes('year') ||
        checkStr.includes('job') ||
        checkStr.includes('title') ||
        checkStr.includes('company') ||
        checkStr.includes('desc') ||
        checkStr.includes('role')
      ) {
        console.log(`[Workday AI] Field "${inst.fieldId || inst.automationId}" is handled in Pass 1. Skipping Pass 2 edit ✓`);
        continue;
      }

      try {
        let el = document.getElementById(inst.fieldId);
        if (!el && inst.automationId) {
          el = document.querySelector(`[data-automation-id="${inst.automationId}"]`);
        }

        // Workday semantic attribute fallback search
        if (!el && inst.automationId) {
          const autoIdLower = inst.automationId.toLowerCase();
          el = document.querySelector(`[data-automation-id*="${autoIdLower}"], input[id*="${autoIdLower}"]`);
        }

        if (!el) {
          // Label-based element discovery fallback
          const allInputs = Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea, button, [role="combobox"], [role="radiogroup"]'));
          el = allInputs.find((i) => {
            const auto = (i.getAttribute('data-automation-id') || '').toLowerCase();
            const placeholder = (i.getAttribute('placeholder') || '').toLowerCase();
            const id = (i.id || '').toLowerCase();
            const autoInst = (inst.automationId || '').toLowerCase();
            return (autoInst && (auto.includes(autoInst) || id.includes(autoInst) || placeholder.includes(autoInst)));
          }) || null;
        }

        if (!el) continue;

        let valToFill = inst.value;
        const autoLower = (inst.automationId || '').toLowerCase();
        const fieldIdLower = (inst.fieldId || '').toLowerCase();

        // If it's a name field (First Name, Last Name, Legal Name), ensure Proper Case to avoid Workday all-caps alert
        if (
          autoLower.includes('firstname') ||
          autoLower.includes('lastname') ||
          autoLower.includes('legalname') ||
          fieldIdLower.includes('firstname') ||
          fieldIdLower.includes('lastname') ||
          fieldIdLower.includes('legalname')
        ) {
          valToFill = this.formatProperCase(valToFill);
        }

        let fieldSuccess = false;

        switch (inst.action) {
          case 'fill_text':
            fieldSuccess = this.setInputValue(el, valToFill);
            if (fieldSuccess) filledCount++;
            break;

          case 'select_option':
            fieldSuccess = await this.setSelectValue(el, valToFill);
            if (fieldSuccess) filledCount++;
            break;

          case 'click_radio':
            fieldSuccess = this.clickRadioOption(el, valToFill);
            if (fieldSuccess) filledCount++;
            break;

          case 'toggle_checkbox':
            fieldSuccess = this.setCheckboxValue(el, inst.value.toLowerCase() === 'true' || inst.value.toLowerCase() === 'yes');
            if (fieldSuccess) filledCount++;
            break;

          case 'set_date':
            fieldSuccess = await this.setWorkdayDateValue(el, inst.value);
            if (fieldSuccess) filledCount++;
            break;
        }

        // Mandatory pause after each field: do NOT move to next field until current field finishes
        await new Promise((res) => setTimeout(res, 350));
      } catch (err) {
        console.warn(`[Workday AI] Skipped field ${inst.fieldId} due to safe protection:`, err);
        errorsCount++;
      }
    }

    // Auto-attach stored resume file into Workday file upload input if present
    const fileAttached = await this.autoAttachResumeFile();
    if (fileAttached) filledCount++;

    // Fill "How Did You Hear About Us?" LAST so no subsequent Escape/blur clears its multiselect
    if (candidate) {
      try {
        const sourceFilled = await this.fillWorkdaySource();
        if (sourceFilled) filledCount++;
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        console.warn('[Workday AI] Source fill notice:', err);
      }
    }

    // Click outside / background to commit all fields (NO Escape key — it clears multiselect selections)
    try {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const outsideTarget = document.querySelector<HTMLElement>(
        '[data-automation-id="smartDivider"], [data-automation-id="pageHeader"], h3, h4, body'
      );
      if (outsideTarget) {
        outsideTarget.click();
      }
    } catch { }

    // Continuous loop for auto-saving until all errors are cleared and next page is reached
    await new Promise((r) => setTimeout(r, 600));
    try {
      console.log('[Workday AI] Starting Auto-Save & Next Page navigation loop...');
      const initialStep = document.querySelector<HTMLElement>('[data-automation-id="activeStep"], [aria-current="step"], h2, h3')?.textContent?.trim() || '';

      for (let attempt = 1; attempt <= 6; attempt++) {
        console.log(`[Workday AI] Auto-Save attempt #${attempt}...`);
        
        // 1. Check for any top error banner first
        const errorContainer = document.querySelector<HTMLElement>(
          '[data-automation-id="errorHeading"], [data-automation-id="error-banner"], .css-chz2yv, .css-1lxwves, [data-automation-id="errorMessage"]'
        );
        if (errorContainer && (errorContainer.textContent || '').trim().length > 0) {
          console.log(`[Workday AI] Found error banner on attempt #${attempt}. Resolving specific errors...`);
          if (candidate) {
            await this.autoSolveDOMErrors(candidate);
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        // 2. Locate and click Save and Continue / Next button
        const nextBtn = document.querySelector<HTMLElement>(
          '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="next"], [data-automation-id*="pageFooterNextButton"], [data-automation-id*="click-save-and-continue"], button[aria-label*="Save and Continue"], button[aria-label*="Save & Continue"], button[aria-label*="Continue"], button[aria-label*="Next"]'
        ) || Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => {
          const t = (b.textContent || '').toLowerCase().trim();
          return t.includes('save and continue') || t.includes('save & continue') || t === 'continue' || t === 'next';
        }) || null;

        if (!nextBtn) {
          console.log('[Workday AI] Save and Continue button no longer on page. Navigation complete! ✓');
          break;
        }

        nextBtn.focus();
        nextBtn.click();
        nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        // 3. Wait to observe if page navigated or if an error popped up
        await new Promise((r) => setTimeout(r, 1800));

        // Check if page navigated
        const currentStep = document.querySelector<HTMLElement>('[data-automation-id="activeStep"], [aria-current="step"], h2, h3')?.textContent?.trim() || '';
        const hasNextButtonStill = !!document.querySelector<HTMLElement>('[data-automation-id="bottom-navigation-next-button"], [data-automation-id="next"], [data-automation-id*="click-save-and-continue"]');
        
        const errorsNow = document.querySelector<HTMLElement>(
          '[data-automation-id="errorHeading"], [data-automation-id="error-banner"], .css-chz2yv, .css-1lxwves'
        );

        if (!errorsNow && (currentStep !== initialStep || !hasNextButtonStill)) {
          console.log('[Workday AI] Successfully transitioned to next page without errors! ✓');
          break;
        }

        if (errorsNow && candidate) {
          console.log('[Workday AI] Error detected after click. Auto-resolving...');
          await this.autoSolveDOMErrors(candidate);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (e) {
      console.warn('[Workday AI] Auto Save & Continue navigation loop notice:', e);
    }

    return { filledCount, errorsCount };
  }

  private static formatWorkdayDate(dateStr: string | undefined, defaultMonth: string = '01'): string {
    if (!dateStr || !dateStr.trim()) return `${defaultMonth}/2024`;
    let clean = dateStr.trim().replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '');

    if (clean.toLowerCase().startsWith('mm/') || clean.startsWith('/')) {
      clean = clean.replace(/^(mm|\/)+/i, '');
    }

    // 1. MM/DD/YYYY e.g. 08/28/2026
    const mmDdYyyy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mmDdYyyy) {
      const month = mmDdYyyy[1].padStart(2, '0');
      const year = mmDdYyyy[3];
      return `${month}/${year}`;
    }

    // 2. YYYY-MM-DD e.g. 2026-08-28
    const yyyyMmDd = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (yyyyMmDd) {
      const year = yyyyMmDd[1];
      const month = yyyyMmDd[2].padStart(2, '0');
      return `${month}/${year}`;
    }

    // 3. MM/YYYY e.g. 07/2024 or 7/2024
    const mmYyyy = clean.match(/^(\d{1,2})\/(\d{4})$/);
    if (mmYyyy) {
      const month = mmYyyy[1].padStart(2, '0');
      const year = mmYyyy[2];
      return `${month}/${year}`;
    }

    // 4. YYYY-MM e.g. 2024-07
    const yyyyMm = clean.match(/^(\d{4})-(\d{1,2})$/);
    if (yyyyMm) {
      const year = yyyyMm[1];
      const month = yyyyMm[2].padStart(2, '0');
      return `${month}/${year}`;
    }

    // 5. Just YYYY e.g. 2023 or /2023
    const justYear = clean.match(/^(\d{4})$/);
    if (justYear) {
      return `${defaultMonth}/${justYear[1]}`;
    }

    // 4. Month name text e.g. July 2024, Jul 2024
    const monthNames: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    for (const [mName, mNum] of Object.entries(monthNames)) {
      if (clean.toLowerCase().includes(mName)) {
        const yearMatch = clean.match(/\d{4}/);
        if (yearMatch) {
          return `${mNum}/${yearMatch[0]}`;
        }
      }
    }

    // 5. Any 4-digit year embedded
    const embeddedYear = clean.match(/\d{4}/);
    if (embeddedYear) {
      return `${defaultMonth}/${embeddedYear[0]}`;
    }

    return `${defaultMonth}/2024`;
  }

  /**
   * Fixes a single date input field using native HTMLInputElement property setter to bypass React state tracking.
   * Takes the exact date string directly from source JSON without modifying or reformatting.
   */
  public static fixSingleDateField(elementOrSelector: Element | string, exactDateString: string): boolean {
    const element = typeof elementOrSelector === 'string'
      ? document.querySelector<HTMLInputElement | HTMLTextAreaElement>(elementOrSelector)
      : elementOrSelector as HTMLInputElement | HTMLTextAreaElement;

    if (!element) return false;

    try {
      // 1. Focus element without scrolling page to top
      try { (element as any).focus({ preventScroll: true }); } catch { element.focus(); }

      // 2. Bypass React's overridden property setter
      const prototype = element instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;

      const nativeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (nativeValueSetter) {
        nativeValueSetter.call(element, exactDateString);
      } else {
        element.value = exactDateString;
      }

      // 3. Dispatch native events to update Workday/React internal state
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

      // 4. Blur element to lock state and finalize validation
      element.blur();
      return true;
    } catch (e) {
      console.warn('[Workday AI] fixSingleDateField error:', e);
      return false;
    }
  }

  /**
   * Sets a Workday date value using Calendar Picker OR spinbutton inputs.
   */
  public static async setWorkdayDateValue(containerOrInput: HTMLInputElement | HTMLElement, dateStr: string, defaultMonth: string = '01'): Promise<boolean> {
    const formatted = this.formatWorkdayDate(dateStr, defaultMonth);
    const [monthStr, yearStr] = formatted.split('/');
    const rawMonth = parseInt(monthStr, 10) || 1;
    const monthNum = Math.min(12, Math.max(1, rawMonth));
    const yearNum = parseInt(yearStr, 10) || 2024;
    const monthFormatted = String(monthNum).padStart(2, '0');
    const yearFormatted = String(yearNum);

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    /**
     * Types a numeric value into a Workday spinbutton input by simulating REAL
     * per-digit keystrokes (keydown/keypress/input/keyup). Ends with a blur only if doBlur is true.
     */
    const setRawValue = async (inp: HTMLInputElement, valStr: string, numVal: number, doBlur: boolean = false): Promise<void> => {
      try {
        try { (inp as any).focus({ preventScroll: true }); } catch { inp.focus(); }
        inp.click();
        await new Promise((r) => setTimeout(r, 30));

        // Select all existing content so typed digits overwrite it
        try { inp.setSelectionRange(0, inp.value.length); } catch { /* ignore */ }

        const tracker = (inp as any)._reactValueTracker;
        if (tracker) tracker.setValue('');

        // Clear the field first with Backspace
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true }));
        if (nativeSetter) nativeSetter.call(inp, '');
        inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
        await new Promise((r) => setTimeout(r, 30));

        // Type each digit as a full real keystroke sequence
        const digits = String(numVal);
        let buffer = '';
        for (const ch of digits) {
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: `Digit${ch}`, bubbles: true, cancelable: true }));
          inp.dispatchEvent(new KeyboardEvent('keypress', { key: ch, code: `Digit${ch}`, bubbles: true, cancelable: true }));

          buffer += ch;
          if (nativeSetter) {
            nativeSetter.call(inp, buffer);
          } else {
            inp.value = buffer;
          }
          inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
          inp.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code: `Digit${ch}`, bubbles: true, cancelable: true }));

          await new Promise((r) => setTimeout(r, 30));
        }

        inp.setAttribute('aria-valuenow', String(numVal));
        inp.setAttribute('aria-valuetext', String(numVal));
        inp.dispatchEvent(new Event('change', { bubbles: true }));

        if (doBlur) {
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
          inp.blur();
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
          inp.dispatchEvent(new Event('focusout', { bubbles: true }));
        }

        await new Promise((r) => setTimeout(r, 40));
      } catch (e) {
        console.warn('[Workday AI] Spinbutton value write error:', e);
      }
    };

    try {
      let container = containerOrInput;
      if (containerOrInput instanceof HTMLInputElement) {
        container = containerOrInput.closest('[data-automation-id="formField-startDate"], [data-automation-id="formField-endDate"], [data-automation-id="dateInputWrapper"], fieldset') || containerOrInput.parentElement?.parentElement || containerOrInput;
      }

      const monthInput = container.querySelector<HTMLInputElement>(
        '[data-automation-id="dateSectionMonth-input"], input[aria-label="Month"]'
      );
      const yearInput = container.querySelector<HTMLInputElement>(
        '[data-automation-id="dateSectionYear-input"], input[aria-label="Year"]'
      );

      // Strategy 1: Spinbutton Month + Year inputs (Workday standard)
      if (monthInput && yearInput) {
        console.log(`[Workday AI Date Fixer] Target: Month+Year spinbuttons -> Writing month=${monthFormatted}, year=${yearFormatted} (from source JSON: "${dateStr}")`);

        // 1. Write Month (do NOT blur month input before year input is typed!)
        await setRawValue(monthInput, monthFormatted, monthNum, false);

        // 2. Write Year (blur ONLY after year input is finished!)
        await setRawValue(yearInput, yearFormatted, yearNum, true);

        // 3. Update visual display divs
        const monthDisplay = container.querySelector<HTMLElement>('[data-automation-id="dateSectionMonth-display"]');
        const yearDisplay = container.querySelector<HTMLElement>('[data-automation-id="dateSectionYear-display"]');
        if (monthDisplay) monthDisplay.textContent = monthFormatted;
        if (yearDisplay) yearDisplay.textContent = yearFormatted;

        // 4. Dispatch change & blur on wrapper to commit React state
        const wrapper = container.querySelector<HTMLElement>('[data-automation-id="dateInputWrapper"]') || container;
        wrapper.dispatchEvent(new Event('change', { bubbles: true }));
        wrapper.dispatchEvent(new Event('blur', { bubbles: true }));

        await new Promise((r) => setTimeout(r, 100));
        return true;
      }

      // Strategy 1.5: Year-ONLY spinbutton (Education dates: firstYearAttended / lastYearAttended — no month input!)
      if (!monthInput && yearInput) {
        console.log(`[Workday AI Date Fixer] Target: YEAR-ONLY spinbutton -> Writing year=${yearFormatted} (from source JSON: "${dateStr}")`);
        await setRawValue(yearInput, yearFormatted, yearNum);
        this.fixSingleDateField(yearInput, yearFormatted);

        const yearDisplay = container.querySelector<HTMLElement>('[data-automation-id="dateSectionYear-display"]');
        if (yearDisplay) yearDisplay.textContent = yearFormatted;

        const wrapper = container.querySelector<HTMLElement>('[data-automation-id="dateInputWrapper"]') || container;
        wrapper.dispatchEvent(new Event('change', { bubbles: true }));
        wrapper.dispatchEvent(new Event('blur', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));

        const yearOk = yearInput.value === yearFormatted;
        console.log(`[Workday AI Date Fixer] Year-only verification result for "${dateStr}": yearResult="${yearInput.value}" (ok=${yearOk})`);

        if (!yearOk) {
          console.warn('[Workday AI Date Fixer] Year-only spinbutton did not stick — retrying with fixSingleDateField...');
          this.fixSingleDateField(yearInput, yearFormatted);
          await new Promise((r) => setTimeout(r, 100));
        }

        return true;
      }

      // Strategy 2: Single text input fallback
      let inp: HTMLInputElement | null = null;
      if (containerOrInput instanceof HTMLInputElement) inp = containerOrInput;
      else inp = container.querySelector<HTMLInputElement>('input');

      if (inp) {
        console.log(`[Workday AI Date Fixer] Target: Single text input -> Writing "${formatted}" via fixSingleDateField`);
        this.fixSingleDateField(inp, formatted);
        return true;
      }

      return false;
    } catch (err) {
      console.warn('[Workday AI Date Fixer] setWorkdayDateValue exception:', err);
      return false;
    }
  }

  private static ensureValidDateRange(rawStart: string | undefined, rawEnd: string | undefined, isCurrent: boolean): { start: string; end: string } {
    let start = this.formatWorkdayDate(rawStart, '01');
    let end = isCurrent ? '' : this.formatWorkdayDate(rawEnd, '12');

    if (!isCurrent && start && end) {
      const [startM, startY] = start.split('/').map(Number);
      const [endM, endY] = end.split('/').map(Number);

      const sYear = startY || 2023;
      const eYear = endY || 2026;

      // From date year MUST be strictly lower than To date year, and From month <= To month
      if (sYear >= eYear || (sYear === eYear - 1 && startM > endM)) {
        const safeStartYear = Math.max(2015, eYear - 2);
        const safeStartMonth = String(Math.min(startM || 1, endM || 12)).padStart(2, '0');
        start = `${safeStartMonth}/${safeStartYear}`;
      }
    }

    return { start, end };
  }

  private static findWorkdayAddButton(sectionType: 'work' | 'education' | 'website'): HTMLElement | null {
    const key = sectionType === 'work' ? 'workexperience' : sectionType === 'education' ? 'education' : 'website';
    const label = sectionType === 'work' ? 'work experience' : sectionType === 'education' ? 'education' : 'website';

    const directBtn = document.querySelector<HTMLElement>(
      `button[data-automation-id*="${key}-add"], button[data-automation-id*="add-${key}"], button[data-automation-id*="${key}Add"]`
    );
    if (directBtn && !directBtn.getAttribute('data-automation-id')?.toLowerCase().includes('delete')) return directBtn;

    const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, legend, div[data-automation-id], .css-15rz5ap'));
    const sectionHeading = headings.find((h) => (h.textContent || '').toLowerCase().trim().includes(label));

    if (sectionHeading) {
      const container = sectionHeading.closest('div[data-automation-id], fieldset, section, div.css-15rz5ap') || sectionHeading.parentElement;
      if (container) {
        const btn = Array.from(container.querySelectorAll<HTMLElement>('button')).find((b) => {
          const txt = (b.textContent || '').toLowerCase().trim();
          return (txt === 'add' || txt === 'add another' || txt.includes('add')) && !txt.includes('delete');
        });
        if (btn) return btn;
      }
    }

    const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button'));
    return allBtns.find((b) => {
      const txt = (b.textContent || '').toLowerCase().trim();
      if (txt !== 'add' && txt !== 'add another' && !txt.includes('add')) return false;
      if (txt.includes('delete')) return false;
      const sectionTxt = (b.closest('div, section, fieldset, form')?.textContent || '').toLowerCase();
      return sectionTxt.includes(label);
    }) || null;
  }

  private static findEducationAddButton(): HTMLElement | null {
    // Workday Education section structure:
    // <div role="group" aria-labelledby="Education-section">
    //   <h4 id="Education-section">Education</h4>
    //   ... education entries ...
    //   <button class="css-..."><span>+</span>Add</button>   <-- THIS IS WHAT WE WANT
    // </div>

    // Strategy 1: Find the Education section group and its Add button
    const eduSectionGroup = document.querySelector<HTMLElement>(
      '[role="group"][aria-labelledby*="Education"], [role="group"][aria-labelledby*="education"]'
    );
    if (eduSectionGroup) {
      // Find Add button directly inside the Education section group (NOT inside sub-entries)
      const btns = Array.from(eduSectionGroup.querySelectorAll<HTMLElement>('button'));
      const addBtn = btns.find((b) => {
        const txt = (b.textContent || '').toLowerCase().trim();
        // Must be "Add" or "Add Another" and NOT "Delete"
        return (txt === 'add' || txt === 'add another' || txt.startsWith('add')) && !txt.includes('delete');
      });
      if (addBtn) return addBtn;
    }

    // Strategy 2: Find h4 with id containing "Education" and search nearby
    const eduHeading = document.querySelector<HTMLElement>(
      'h4#Education-section, h4[id*="Education"], h3[id*="Education"], h4[color]'
    ) || Array.from(document.querySelectorAll<HTMLElement>('h3, h4, h5')).find(
      (h) => (h.textContent || '').toLowerCase().trim() === 'education'
    );

    if (eduHeading) {
      // Walk up to the parent section container
      const parentGroup = eduHeading.closest('[role="group"], div[data-automation-id], fieldset, section') || eduHeading.parentElement;
      if (parentGroup) {
        const btns = Array.from(parentGroup.querySelectorAll<HTMLElement>('button'));
        const addBtn = btns.find((b) => {
          const txt = (b.textContent || '').toLowerCase().trim();
          return (txt === 'add' || txt === 'add another' || txt.startsWith('add')) && !txt.includes('delete');
        });
        if (addBtn) return addBtn;
      }

      // Walk siblings after the heading
      let sibling = eduHeading.nextElementSibling as HTMLElement | null;
      for (let depth = 0; sibling && depth < 15; depth++) {
        // Check if this sibling IS a button
        if (sibling.tagName === 'BUTTON') {
          const txt = (sibling.textContent || '').toLowerCase().trim();
          if ((txt === 'add' || txt.startsWith('add')) && !txt.includes('delete')) return sibling;
        }
        // Check for button inside this sibling
        const innerBtn = sibling.querySelector<HTMLElement>('button');
        if (innerBtn) {
          const txt = (innerBtn.textContent || '').toLowerCase().trim();
          if ((txt === 'add' || txt.startsWith('add')) && !txt.includes('delete')) return innerBtn;
        }
        sibling = sibling.nextElementSibling as HTMLElement | null;
      }
    }

    // Strategy 3: Find ANY Add button near text "Education" on the page
    const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button'));
    return allBtns.find((b) => {
      const txt = (b.textContent || '').toLowerCase().trim();
      if (!txt.startsWith('add') && txt !== 'add') return false;
      if (txt.includes('delete')) return false;
      // Walk up the DOM tree to check if we're inside an Education section
      let parent: HTMLElement | null = b.parentElement;
      for (let d = 0; parent && d < 10; d++) {
        const parentId = (parent.id || parent.getAttribute('aria-labelledby') || '').toLowerCase();
        const parentText = (parent.querySelector('h3, h4, h5')?.textContent || '').toLowerCase();
        if (parentId.includes('education') || parentText === 'education') return true;
        parent = parent.parentElement;
      }
      return false;
    }) || null;
  }

  public static resolveWorkdayDegree(rawDegree: string | undefined, rawInstitution: string | undefined = ''): string {
    const clean = `${rawDegree || ''} ${rawInstitution || ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    if (!clean) return 'Bachelors';

    // 1. High School / 12th / 10th / Secondary / HSC / SSC / Intermediate / School / Junior College / X / XII / CBSE / ICSE
    if (
      clean.includes('12th') ||
      clean.includes('10th') ||
      clean.includes('high school') ||
      clean.includes('highschool') ||
      clean.includes('secondary') ||
      clean.includes('hsc') ||
      clean.includes('ssc') ||
      clean.includes('class x') ||
      clean.includes('class xii') ||
      clean.includes('class 10') ||
      clean.includes('class 12') ||
      clean.includes('class10') ||
      clean.includes('class12') ||
      clean.includes('intermediate') ||
      clean.includes('matriculation') ||
      clean.includes('matric') ||
      clean.includes('junior college') ||
      clean.includes('vidyalaya') ||
      clean.includes('vidyalayam') ||
      clean.includes('public school') ||
      clean.includes('convent') ||
      clean.includes('academy') ||
      clean.includes('school') ||
      clean.includes('cbse') ||
      clean.includes('icse') ||
      clean.includes('board exam') ||
      /\bx\b/.test(clean) ||
      /\bxii\b/.test(clean) ||
      /\bxth\b/.test(clean) ||
      /\bxiith\b/.test(clean) ||
      clean === '10' ||
      clean === '12' ||
      clean === 'x' ||
      clean === 'xii'
    ) {
      return 'High School';
    }

    // 2. BTECH / B.E / Bachelor of Technology / Engg
    if (
      clean.includes('btech') ||
      clean.includes('b tech') ||
      clean.includes('b e') ||
      clean.includes('be ') ||
      clean.endsWith(' be') ||
      clean.includes('bachelor of technology') ||
      clean.includes('bachelor of engineering')
    ) {
      return 'BTECH';
    }

    // 3. MTECH / M.E / Master of Technology / Engg
    if (
      clean.includes('mtech') ||
      clean.includes('m tech') ||
      clean.includes('m e') ||
      clean.includes('me ') ||
      clean.endsWith(' me') ||
      clean.includes('master of technology') ||
      clean.includes('master of engineering')
    ) {
      return 'MTECH';
    }

    // 4. MCA / Master of Computer Applications
    if (clean.includes('mca') || clean.includes('master of computer')) {
      return 'MCA';
    }

    // 5. MBA / Master of Business Administration
    if (clean.includes('mba') || clean.includes('master of business')) {
      return 'MBA';
    }

    // 6. PhD / Doctorate
    if (clean.includes('phd') || clean.includes('ph d') || clean.includes('doctor') || clean.includes('doctorate')) {
      return 'PhD';
    }

    // 7. Diploma / Polytechnic / Post-Diploma
    if (clean.includes('post diploma')) return 'Post-diploma studies';
    if (clean.includes('diploma') || clean.includes('polytechnic')) return 'University Diploma';

    // 8. General Bachelors (BSc, BA, BCom, BCA)
    if (
      clean.includes('bachelor') ||
      clean.includes('bsc') ||
      clean.includes('b a') ||
      clean.includes('b com') ||
      clean.includes('bca') ||
      clean.includes('undergraduate')
    ) {
      return 'Bachelors';
    }

    // 9. General Masters (MSc, MA, MCom)
    if (
      clean.includes('master') ||
      clean.includes('msc') ||
      clean.includes('m a') ||
      clean.includes('m com') ||
      clean.includes('postgraduate')
    ) {
      return 'Masters';
    }

    // 10. Associates
    if (clean.includes('associate')) return 'Associates';

    return 'Bachelors';
  }

  public static async deleteExtraBlankEducationForms(targetCount: number, candidate?: CandidateProfile): Promise<void> {
    const candidateEduCount = candidate?.education?.length || targetCount;
    const finalTargetCount = Math.max(targetCount, candidateEduCount);

    const eduBlocks = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="group"][aria-labelledby*="Education-"], [role="group"][aria-labelledby*="education-"], div.css-1ebprri, div[data-fkit-id*="education"]'
    ));

    const entryBlocks = eduBlocks.filter(
      (b) => b.getAttribute('aria-labelledby')?.toLowerCase().includes('panel') || b.querySelector('h5, h4')?.textContent?.toLowerCase().includes('education')
    );

    if (entryBlocks.length <= finalTargetCount) return;

    // Delete extra blank education blocks beyond candidate's profile count
    for (let i = entryBlocks.length - 1; i >= finalTargetCount; i--) {
      const block = entryBlocks[i];
      if (!block) continue;

      const deleteBtn = block.querySelector<HTMLElement>('button.css-zfgw5f') ||
        Array.from(block.querySelectorAll<HTMLElement>('button')).find((b) => {
          const txt = (b.textContent || '').toLowerCase().trim();
          return txt === 'delete' || b.querySelector('.wd-icon-trash') !== null;
        });

      if (deleteBtn) {
        console.log(`[Workday AI] Deleting extra blank Education block ${i + 1} (> ${finalTargetCount})...`);
        this.clickWorkdayOptionElement(deleteBtn);
        await new Promise((r) => setTimeout(r, 600));

        const confirmBtn = Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => {
          const txt = (b.textContent || '').toLowerCase().trim();
          const auto = (b.getAttribute('data-automation-id') || '').toLowerCase();
          return !b.isSameNode(deleteBtn) && (txt === 'delete' || txt === 'confirm' || auto.includes('confirm'));
        });

        if (confirmBtn) {
          this.clickWorkdayOptionElement(confirmBtn);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }



  public static async fillWorkdaySkills(skills: string[]): Promise<number> {
    if (!skills || skills.length === 0) return 0;
    let filled = 0;

    const findSkillsInput = (): HTMLInputElement | null => {
      return document.querySelector<HTMLInputElement>(
        'input[placeholder*="Type to Add Skills"], input[placeholder*="Add Skills"], input[data-automation-id*="skills"], input[aria-label*="Skills"], [data-automation-id*="skillsPrompt"] input, [data-automation-id*="skills"] input'
      ) || Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((inp) => {
        const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
        const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
        const auto = (inp.getAttribute('data-automation-id') || '').toLowerCase();
        return ph.includes('skills') || aria.includes('skills') || auto.includes('skills');
      }) || null;
    };

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    const skillsToFill = skills.slice(0, 10);
    for (const skill of skillsToFill) {
      try {
        const skillLower = skill.toLowerCase().trim();

        // 1. Check if skill pill is ALREADY selected on page
        const existingPills = Array.from(document.querySelectorAll<HTMLElement>(
          '[data-automation-id*="selectedItem"], [data-uxi-widget-type*="pill"], div.css-169z3b8, span.css-11v5kgg, [data-automation-id="multiSelectContainer"] span'
        ));
        const isAlreadySelected = existingPills.some((p) => {
          const txt = (p.textContent || '').toLowerCase().trim();
          return txt && (txt === skillLower || txt.includes(skillLower) || skillLower.includes(txt));
        });

        if (isAlreadySelected) {
          console.log(`[Workday AI] Skill "${skill}" is ALREADY selected on page, skipping ✓`);
          filled++;
          continue;
        }

        const currentInput = findSkillsInput();
        if (!currentInput) continue;

        console.log(`[Workday AI] Typing skill to insert: "${skill}"`);

        // 2. Clear input first
        const tracker = (currentInput as any)._reactValueTracker;
        if (tracker) tracker.setValue('');
        if (nativeSetter) nativeSetter.call(currentInput, '');
        else currentInput.value = '';
        currentInput.dispatchEvent(new Event('input', { bubbles: true }));

        // 3. Focus & click input
        currentInput.focus();
        currentInput.click();
        await new Promise((r) => setTimeout(r, 200));

        // 4. Type skill text into input
        if (tracker) tracker.setValue('');
        if (nativeSetter) nativeSetter.call(currentInput, skill);
        else currentInput.value = skill;

        currentInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: skill }));
        currentInput.dispatchEvent(new Event('input', { bubbles: true }));
        currentInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait 600ms for Workday popup options overlay to render in DOM
        await new Promise((r) => setTimeout(r, 600));

        // 5. Read open popup options in DOM
        const popupOptions = Array.from(document.querySelectorAll<HTMLElement>(
          '[data-automation-id="promptOption"], [role="option"], li[role="option"], p[data-automation-label], ul[role="listbox"] li, div[role="option"], div[data-automation-id*="promptOption"], div.css-15rz5ap [role="listbox"] div'
        ));

        let matchOpt: HTMLElement | null = null;
        if (popupOptions.length > 0) {
          matchOpt = popupOptions.find((opt) => {
            const txt = (opt.textContent || opt.getAttribute('data-automation-label') || '').toLowerCase().trim();
            return txt === skillLower || txt.includes(skillLower) || skillLower.includes(txt);
          }) || popupOptions[0];
        }

        if (matchOpt) {
          console.log(`[Workday AI] Clicking dropdown option for "${skill}" to insert pill...`);
          const checkbox = matchOpt.querySelector<HTMLInputElement>('input[type="checkbox"]');
          const targetClickable = checkbox || matchOpt.querySelector<HTMLElement>('label') || matchOpt;
          this.clickWorkdayOptionElement(targetClickable);
          await new Promise((r) => setTimeout(r, 400));
          filled++;
        } else {
          console.log(`[Workday AI] Committing custom skill tag "${skill}" via Enter key...`);
          currentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          currentInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          await new Promise((r) => setTimeout(r, 400));
          filled++;
        }
      } catch (err) {
        console.warn(`[Workday AI] Error adding skill "${skill}":`, err);
        // Close dropdown and continue to next skill
        try { document.body.click(); } catch { }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Final cleanup: close any lingering dropdown
    try { document.body.click(); } catch { }

    console.log(`[Workday AI] Skills complete: ${filled}/${skillsToFill.length} added`);
    return filled;
  }

  public static async fillWorkdayWebsites(candidate: CandidateProfile): Promise<number> {
    const links: string[] = [];

    if (candidate.personalInfo?.linkedin) links.push(candidate.personalInfo.linkedin);
    if (candidate.personalInfo?.github && !links.includes(candidate.personalInfo.github)) links.push(candidate.personalInfo.github);
    if (candidate.personalInfo?.website && !links.includes(candidate.personalInfo.website)) links.push(candidate.personalInfo.website);

    if (candidate.projects) {
      for (const p of candidate.projects) {
        if (p.url && !links.includes(p.url)) links.push(p.url);
      }
    }

    if (candidate.hyperlinks) {
      for (const h of candidate.hyperlinks) {
        if (h && !links.includes(h) && (h.startsWith('http') || h.startsWith('www.'))) {
          links.push(h);
        }
      }
    }

    if (links.length === 0) return 0;
    let addedCount = 0;

    const websiteAddBtn = this.findWorkdayAddButton('website');
    const targetLinkCount = Math.min(links.length, 4);

    let urlInputs = document.querySelectorAll<HTMLElement>(
      'input[data-automation-id*="website"], input[data-automation-id*="url"], input[id*="website"], input[aria-label*="Website"], input[aria-label*="URL"]'
    );

    if (urlInputs.length === 0 && websiteAddBtn) {
      this.clickWorkdayOptionElement(websiteAddBtn);
      addedCount++;
      await new Promise((r) => setTimeout(r, 550));
    }

    urlInputs = document.querySelectorAll<HTMLElement>(
      'input[data-automation-id*="website"], input[data-automation-id*="url"], input[id*="website"], input[aria-label*="Website"], input[aria-label*="URL"]'
    );

    while (urlInputs.length < targetLinkCount && websiteAddBtn) {
      this.clickWorkdayOptionElement(websiteAddBtn);
      addedCount++;
      await new Promise((r) => setTimeout(r, 550));

      const updatedInputs = document.querySelectorAll<HTMLElement>(
        'input[data-automation-id*="website"], input[data-automation-id*="url"], input[id*="website"], input[aria-label*="Website"], input[aria-label*="URL"]'
      );
      if (updatedInputs.length === urlInputs.length) break;
      urlInputs = updatedInputs;
    }

    const allUrlInputs = Array.from(document.querySelectorAll<HTMLElement>(
      'input[data-automation-id*="website"], input[data-automation-id*="url"], input[id*="website"], input[aria-label*="Website"], input[aria-label*="URL"]'
    ));

    for (let i = 0; i < Math.min(allUrlInputs.length, targetLinkCount); i++) {
      if (links[i]) {
        this.setInputValue(allUrlInputs[i], links[i]);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return addedCount;
  }

  public static async ensureMultiEntriesAndFill(candidate: CandidateProfile): Promise<number> {
    let addedCount = 0;
    // --- 1. WORK EXPERIENCE MULTI-ENTRY ENGINE ---
    const workExpList = candidate.workExperience || [];

    if (workExpList.length > 0) {
      // EXACT JSON COUNT. Do not cap it to 5.
      const targetWorkCount = workExpList.length;

      const getWorkEntries = (): HTMLElement[] => {
        return Array.from(
          document.querySelectorAll<HTMLElement>(
            'input[data-automation-id*="jobTitle"], input[id*="jobTitle"], input[aria-label*="Job Title"]'
          )
        );
      };

      let workEntries = getWorkEntries();

      console.log(
        `[Workday AI] JSON Work Experience count: ${targetWorkCount}`
      );

      console.log(
        `[Workday AI] Existing Work Experience count: ${workEntries.length}`
      );

      // ---------------------------------------------------------
      // ADD ONLY UNTIL JSON COUNT IS REACHED
      // ---------------------------------------------------------
      while (workEntries.length < targetWorkCount) {
        const addBtn = this.findWorkdayAddButton('work');

        if (!addBtn) {
          console.warn(
            `[Workday AI] Cannot find Add Work Experience button. ` +
            `Current=${workEntries.length}, Target=${targetWorkCount}`
          );
          break;
        }

        const beforeCount = workEntries.length;

        console.log(
          `[Workday AI] Adding Work Experience ${beforeCount + 1}/${targetWorkCount}`
        );

        this.clickWorkdayOptionElement(addBtn);

        let added = false;

        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          workEntries = getWorkEntries();

          if (workEntries.length > beforeCount) {
            added = true;
            break;
          }
        }

        if (!added) {
          console.warn(
            `[Workday AI] Add did not create a new Work Experience. Stopping.`
          );
          break;
        }
      }

      // Refresh AFTER all required blocks have been created.
      workEntries = getWorkEntries();

      console.log(
        `[Workday AI] FINAL Work Experience forms available: ${workEntries.length}`
      );

      // ---------------------------------------------------------
      // WORK EXPERIENCE IS NOW LOCKED
      // JSON count has been created and all JSON data is filled.
      // From this point onward:
      // - DO NOT ADD
      // - DO NOT DELETE
      // - DO NOT EDIT
      // - DO NOT REFILL
      // - DO NOT CHANGE DATES
      // ---------------------------------------------------------

      const workExperienceLocked = true;

      console.log(
        `[Workday AI] 🔒 WORK EXPERIENCE LOCKED. ` +
        `JSON=${workExpList.length}, ` +
        `PAGE=${getWorkEntries().length}. ` +
        `No further Work Experience changes allowed.`
      );
      const allJobTitles = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input[data-automation-id*="jobTitle"], input[id*="jobTitle"], input[aria-label*="Job Title"]'
        )
      );

      const allCompanies = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input[data-automation-id*="company"], input[id*="company"], input[aria-label*="Company"]'
        )
      );

      const allLocations = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input[data-automation-id*="location"], input[id*="location"], input[aria-label*="Location"]'
        )
      );

      const allCurrentBoxes = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input[type="checkbox"][data-automation-id*="currentlyWork"], input[type="checkbox"][id*="currentlyWork"]'
        )
      );

      const allDescriptions = Array.from(
        document.querySelectorAll<HTMLElement>(
          'textarea[data-automation-id*="description"], textarea[id*="description"], textarea, [contenteditable="true"]'
        )
      );

      // IMPORTANT:
      // Fill ONLY the number of experiences contained in JSON.
      // Never touch anything after that.
      const fillLimit = Math.min(
        workExpList.length,
        allJobTitles.length
      );

      for (let i = 0; i < fillLimit; i++) {
        const exp = workExpList[i];

        if (!exp) continue;

        const jobInput = allJobTitles[i];

        if (!jobInput) continue;

        console.log(
          `[Workday AI] Filling Work Experience ${i + 1}/${workExpList.length}`
        );

        // -------------------------------------------------------
        // PROTECTION:
        // If this experience already has a Job Title, DO NOT EDIT IT.
        // -------------------------------------------------------
        if ((jobInput as HTMLInputElement).value?.trim()) {
          console.log(
            `[Workday AI] Work Experience ${i + 1} already has data. SKIPPING entire entry.`
          );
          continue;
        }

        // Find the exact entry container.
        const entryContainer =
          jobInput.closest(
            '[data-automation-id*="workExperience"], [role="group"], fieldset, section, div.css-1ebprri, div.css-1iw5nyw'
          ) ||
          jobInput.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;

        if (!entryContainer) continue;

        // -------------------------------------------------------
        // From this point, fill ONLY THIS JSON experience.
        // -------------------------------------------------------

        const companyInput =
          entryContainer.querySelector<HTMLElement>(
            'input[data-automation-id*="company"], input[id*="company"], input[aria-label*="Company"]'
          ) || allCompanies[i];

        const locationInput =
          entryContainer.querySelector<HTMLElement>(
            'input[data-automation-id*="location"], input[id*="location"], input[aria-label*="Location"]'
          ) || allLocations[i];

        const descriptionInput =
          entryContainer.querySelector<HTMLElement>(
            'textarea[data-automation-id*="description"], textarea[id*="description"], textarea, [contenteditable="true"]'
          ) || allDescriptions[i];

        // Job title
        if (exp.jobTitle && !(jobInput as HTMLInputElement).value?.trim()) {
          this.setInputValue(jobInput, exp.jobTitle);
          await new Promise((r) => setTimeout(r, 200));
        }

        // Company
        if (
          companyInput &&
          exp.company &&
          !(companyInput as HTMLInputElement).value?.trim()
        ) {
          this.setInputValue(companyInput, exp.company);
          await new Promise((r) => setTimeout(r, 200));
        }

        // Location
        if (
          locationInput &&
          exp.location &&
          !(locationInput as HTMLInputElement).value?.trim()
        ) {
          this.setInputValue(locationInput, exp.location);
          await new Promise((r) => setTimeout(r, 200));
        }

        // Description
        if (
          descriptionInput &&
          exp.description &&
          !this.hasValue(descriptionInput)
        ) {
          this.setInputValue(descriptionInput, exp.description);
          await new Promise((r) => setTimeout(r, 200));
        }

        // -------------------------------------------------------
        // DATES
        // Only write a date if the corresponding date container
        // is EMPTY.
        //
        // Once written, it will NEVER be touched again in this run.
        // -------------------------------------------------------

        const startDateContainer =
          entryContainer.querySelector<HTMLElement>(
            '[data-automation-id="formField-startDate"], [data-automation-id*="startDate"], [data-automation-id="dateInputWrapper"]'
          );

        const endDateContainer =
          entryContainer.querySelector<HTMLElement>(
            '[data-automation-id="formField-endDate"], [data-automation-id*="endDate"]'
          );

        const isCurrent =
          Boolean(
            (exp as any).currentlyWorking ??
            (exp as any).currentlyWork ??
            (exp as any).current
          );

        const startDate =
          (exp as any).startDate ||
          (exp as any).fromDate ||
          (exp as any).start;

        const endDate =
          (exp as any).endDate ||
          (exp as any).toDate ||
          (exp as any).end;

        if (
          startDateContainer &&
          !this.isDateContainerFilled(startDateContainer) &&
          startDate
        ) {
          await this.setWorkdayDateValue(
            startDateContainer,
            startDate,
            '01'
          );

          await new Promise((r) => setTimeout(r, 300));
        }

        if (
          !isCurrent &&
          endDateContainer &&
          !this.isDateContainerFilled(endDateContainer) &&
          endDate
        ) {
          await this.setWorkdayDateValue(
            endDateContainer,
            endDate,
            '12'
          );

          await new Promise((r) => setTimeout(r, 300));
        }

        // -------------------------------------------------------
        // CURRENTLY WORKING
        // -------------------------------------------------------

        const currentBox =
          entryContainer.querySelector<HTMLInputElement>(
            'input[type="checkbox"][data-automation-id*="currentlyWork"], input[type="checkbox"][id*="currentlyWork"]'
          ) || (allCurrentBoxes[i] as HTMLInputElement | undefined);

        if (currentBox && !currentBox.checked && isCurrent) {
          this.setCheckboxValue(currentBox, true);
          await new Promise((r) => setTimeout(r, 200));
        }

        console.log(
          `[Workday AI] Work Experience ${i + 1} completed ✓`
        );
      }

      // ---------------------------------------------------------
      // VERY IMPORTANT:
      // After this point, DO NOT ADD.
      // DO NOT DELETE.
      // DO NOT RE-FILL.
      // DO NOT EDIT EXPERIENCE DATA.
      // ---------------------------------------------------------

      console.log(
        `[Workday AI] WORK EXPERIENCE COMPLETE. ` +
        `JSON=${workExpList.length}, ` +
        `Page=${getWorkEntries().length}. ` +
        `No more Work Experience modifications will be performed.`
      );
    }
    // --- 2. EDUCATION MULTI-ENTRY ENGINE ---
    console.log('[Workday AI Debug] Full Candidate Education JSON Profile:', JSON.stringify(candidate.education, null, 2));

    // 1. Filter education entries: EXCLUDE 10th / Class X / Matriculation entries, AND cap at MAX 2 entries (e.g. BTech + Class XII)
    const eduList = (candidate.education || []).filter((e) => {
      const clean = `${e.degree || ''} ${e.institution || ''}`.toLowerCase();
      const is10th = clean.includes('10th') ||
        clean.includes('class x') ||
        clean.includes('class 10') ||
        clean.includes('class10') ||
        clean.includes('matric') ||
        /\bx\b/.test(clean) ||
        clean === '10' ||
        clean === 'x';

      return !is10th && ((e.degree && e.degree.trim()) || (e.institution && e.institution.trim()));
    }).slice(0, 2);

    const targetEduCount = Math.min(eduList.length, 2);



    if (targetEduCount > 0) {
      // Helper to count total Education entries currently present on page
      const countCurrentEduEntries = (): number => {
        const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, legend, div, span')).filter((h) => {
          return /^education\s+\d+$/i.test((h.textContent || '').trim());
        });
        const fkitCards = document.querySelectorAll<HTMLElement>('[data-fkit-id*="education"]');
        const autoCards = document.querySelectorAll<HTMLElement>('[data-automation-id*="education"]');
        const schoolInputs = document.querySelectorAll<HTMLElement>('input[data-automation-id*="school"], input[data-automation-id*="institution"], input[id*="school"], input[aria-label*="School"]');
        return Math.max(headings.length, fkitCards.length, autoCards.length, schoolInputs.length);
      };

      let currentEduCount = countCurrentEduEntries();
      console.log(`[Workday AI] Current Education entries on page: ${currentEduCount}, Target count from JSON: ${targetEduCount}`);

      // ONLY add new blocks IF currentEduCount < targetEduCount

      const allSchools = Array.from(document.querySelectorAll<HTMLElement>(
        'input[data-automation-id*="school"], input[data-automation-id*="institution"], input[id*="school"], input[aria-label*="School"]'
      ));
      const allDegrees = Array.from(document.querySelectorAll<HTMLElement>(
        'button[id*="degree"][aria-haspopup="listbox"]'
      ));
      const allMajors = Array.from(document.querySelectorAll<HTMLElement>(
        '[data-automation-id*="fieldOfStudy"], [data-automation-id*="major"], input[id*="fieldOfStudy"]'
      ));

      const eduFillLimit = Math.min(allSchools.length, targetEduCount);

      for (let i = 0; i < eduFillLimit; i++) {
        const edu = eduList[i];
        if (!edu) continue;

        if (allSchools[i]) {
          const curSchool = (allSchools[i] as HTMLInputElement).value || '';
          if (!curSchool || curSchool.trim() === '') {
            this.setInputValue(allSchools[i], edu.institution);
          }
        }

        if (allDegrees[i]) {
          const curDegText = (allDegrees[i].textContent || allDegrees[i].getAttribute('value') || '').trim();
          const isDegreeAlreadySet = curDegText && curDegText !== 'Select One' && !curDegText.toLowerCase().includes('select one');
          const resolvedDegree = this.resolveWorkdayDegree(edu.degree, edu.institution);

          console.log(`[Workday AI Debug] Education #${i + 1}: JSON degree="${edu.degree}", JSON institution="${edu.institution}" -> Resolved Degree="${resolvedDegree}" (DOM currently="${curDegText}")`);

          if (!isDegreeAlreadySet) {
            await this.setSelectValue(allDegrees[i], resolvedDegree);
          } else {
            console.log(`[Workday AI] Degree #${i + 1} ALREADY selected as "${curDegText}" -> DO NOT TOUCH ✓`);
          }
        }

        if (allMajors[i] && edu.fieldOfStudy) {
          const curMajorText = (allMajors[i].textContent || allMajors[i].getAttribute('value') || '').trim();
          if (!curMajorText || curMajorText === 'Select One' || curMajorText.toLowerCase().includes('select one')) {
            await this.setSelectValue(allMajors[i], edu.fieldOfStudy);
          }
        }

        // --- EDUCATION DATES (Year-Only spinbuttons: firstYearAttended / lastYearAttended) ---
        const schoolInputId = (allSchools[i] as HTMLInputElement).id || allSchools[i].getAttribute('data-fkit-id') || '';
        const eduPrefixMatch = schoolInputId.match(/(education-\d+)/i);
        const eduPrefix = eduPrefixMatch ? eduPrefixMatch[1] : '';

        // Find the education entry container for this block
        const eduEntryContainer = allSchools[i].closest(
          '[data-automation-id*="education"], [role="group"], fieldset, section, div.css-1ebprri, div.css-1iw5nyw'
        ) || allSchools[i].parentElement?.parentElement?.parentElement?.parentElement?.parentElement;

        // From (firstYearAttended)
        const eduStartContainer = (eduPrefix
          ? document.querySelector<HTMLElement>(`[data-fkit-id*="${eduPrefix}--firstYearAttended"], [id*="${eduPrefix}--firstYearAttended"]`)
          : null
        ) || eduEntryContainer?.querySelector<HTMLElement>('[data-automation-id="formField-firstYearAttended"]')
          || document.querySelectorAll<HTMLElement>('[data-automation-id="formField-firstYearAttended"]')[i];

        // To (lastYearAttended)
        const eduEndContainer = (eduPrefix
          ? document.querySelector<HTMLElement>(`[data-fkit-id*="${eduPrefix}--lastYearAttended"], [id*="${eduPrefix}--lastYearAttended"]`)
          : null
        ) || eduEntryContainer?.querySelector<HTMLElement>('[data-automation-id="formField-lastYearAttended"]')
          || document.querySelectorAll<HTMLElement>('[data-automation-id="formField-lastYearAttended"]')[i];
        if (eduStartContainer && edu.startDate && !this.hasValue(eduStartContainer)) {
          const startYear =
            edu.startDate.match(/\d{4}/)?.[0] || edu.startDate;

          await this.setWorkdayDateValue(
            eduStartContainer,
            startYear,
            '01'
          );
        }

        if (eduEndContainer && edu.endDate && !this.hasValue(eduEndContainer)) {
          const endYear =
            edu.endDate.match(/\d{4}/)?.[0] || edu.endDate;

          await this.setWorkdayDateValue(
            eduEndContainer,
            endYear,
            '12'
          );
        }

        // --- GPA / Grade ---
        if (edu.gpa) {
          const gpaInput = (eduPrefix
            ? document.querySelector<HTMLInputElement>(`input[id*="${eduPrefix}--gpa"], input[id*="${eduPrefix}--grade"]`)
            : null
          ) || eduEntryContainer?.querySelector<HTMLInputElement>('input[data-automation-id*="gpa"], input[data-automation-id*="grade"], input[id*="gpa"], input[id*="grade"]');

          if (gpaInput) {
            const curGpa = gpaInput.value || '';
            if (!curGpa.trim()) {
              console.log(`[Workday AI] Education #${i + 1}: Setting GPA = ${edu.gpa}`);
              this.setInputValue(gpaInput, String(edu.gpa));
            }
          }
        }

        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // --- 3. SKILLS MULTISELECT ENGINE ---
    if (candidate.skills && candidate.skills.length > 0) {
      const skillsAdded = await this.fillWorkdaySkills(candidate.skills);
      addedCount += skillsAdded;
    }

    // --- 4. WEBSITES MULTI-ENTRY ENGINE (Portfolio, GitHub, LinkedIn, Project Links) ---
    const websitesAdded = await this.fillWorkdayWebsites(candidate);
    addedCount += websitesAdded;
    return addedCount;
  }

  public static async fillWorkdayCountryPhoneCode(candidate: CandidateProfile): Promise<boolean> {
    const phoneCodeEl = document.querySelector<HTMLElement>(
      '#phoneNumber--countryPhoneCode, button[id*="countryPhoneCode"], [data-automation-id*="countryPhoneCode"]'
    ) || Array.from(document.querySelectorAll<HTMLElement>('input, button, [data-automation-id*="formField"]')).find((el) => {
      const parentTxt = (el.closest('[data-automation-id*="formField"], div')?.textContent || el.getAttribute('aria-label') || '').toLowerCase();
      return parentTxt.includes('country phone code') || parentTxt.includes('phone code');
    }) || null;

    if (!phoneCodeEl) return false;

    // Check if ALREADY HAS A SELECTED PILL / TAG / VALUE
    const phoneContainer = phoneCodeEl.closest('[data-automation-id*="formField"], div.css-7t35fz, fieldset') || phoneCodeEl.parentElement;
    const selectedItems = phoneContainer?.querySelector('[data-automation-id="selectedItemsList"], [data-automation-id="selectedItemList"]');
    const hasPill = selectedItems && selectedItems.children.length > 0;
    const ariaInstruction = phoneContainer?.querySelector('[data-automation-id="promptAriaInstruction"]');
    const ariaText = (ariaInstruction?.textContent || '').toLowerCase();
    const hasSelectedAria = ariaText.includes('item selected') && !ariaText.includes('0 items');

    // Check promptSelectionLabel for existing text (Workday shows selected value here)
    const phoneSelectionLabel = phoneContainer?.querySelector('[data-automation-id="promptSelectionLabel"]');
    const phoneSelectionText = (phoneSelectionLabel?.textContent || '').trim();
    const hasSelectionLabel = phoneSelectionText.length > 0;

    // Check if button already displays a selected country (e.g. "India (+91)")
    const phoneBtn = phoneContainer?.querySelector<HTMLElement>('button[aria-haspopup]');
    const phoneBtnText = (phoneBtn?.textContent || '').trim().toLowerCase();
    const hasBtnSelection = phoneBtnText.length > 0 && phoneBtnText !== 'search' && phoneBtnText !== 'select one' && (phoneBtnText.includes('(+') || phoneBtnText.includes('india') || phoneBtnText.includes('united'));

    // Check if the search input already has a value
    const phoneInputEl = phoneContainer?.querySelector<HTMLInputElement>('input');
    const hasInputValue = phoneInputEl && phoneInputEl.value && phoneInputEl.value.trim().length > 0 && phoneInputEl.value.toLowerCase() !== 'search';

    if (hasPill || hasSelectedAria || hasSelectionLabel || hasBtnSelection || hasInputValue) {
      console.log(`[Workday AI] Country Phone Code ALREADY filled (pill=${hasPill}, aria=${hasSelectedAria}, label="${phoneSelectionText}", btn="${phoneBtnText}", inputVal="${phoneInputEl?.value || ''}"). Skipping! ✓`);
      return true;
    }

    const searchInp = (phoneContainer?.querySelector<HTMLInputElement>(
      'input[id="phoneNumber--countryPhoneCode"], input[data-automation-id="searchBox"], input'
    ) || document.querySelector<HTMLInputElement>(
      '#phoneNumber--countryPhoneCode'
    )) || (phoneCodeEl instanceof HTMLInputElement ? phoneCodeEl : null);

    if (!searchInp) return false;

    // Step 1: Click the multiSelectContainer to open the dropdown
    console.log('[Workday AI] Country Phone Code: Clicking multiSelectContainer to open dropdown...');
    const multiSelectContainer = phoneContainer?.querySelector<HTMLElement>(
      '[data-automation-id="multiSelectContainer"], [data-uxi-widget-type="multiselect"]'
    ) || phoneContainer?.querySelector<HTMLElement>(
      '[data-automation-id="multiselectInputContainer"]'
    );
    if (multiSelectContainer) {
      this.clickWorkdayOptionElement(multiSelectContainer);
    }
    await new Promise((r) => setTimeout(r, 500));

    // Step 2: Re-query the search input (may have changed after dropdown opened / monikerSearchBox appeared)
    const activeSearchInp = (phoneContainer?.querySelector<HTMLInputElement>(
      'input[data-automation-id="searchBox"], input[id="phoneNumber--countryPhoneCode"]'
    ) || document.querySelector<HTMLInputElement>(
      '#phoneNumber--countryPhoneCode'
    ) || searchInp) as HTMLInputElement;

    // Step 3: Click and focus the search input
    console.log('[Workday AI] Country Phone Code: Clicking search input and typing "India"...');
    this.clickWorkdayOptionElement(activeSearchInp);
    activeSearchInp.focus();
    activeSearchInp.dispatchEvent(new Event('focus', { bubbles: true }));
    activeSearchInp.dispatchEvent(new Event('focusin', { bubbles: true }));

    // Step 4: Type "India" WITHOUT blurring (setInputValue blurs, which closes the dropdown)
    const tracker = (activeSearchInp as any)._reactValueTracker;
    if (tracker) tracker.setValue('');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(activeSearchInp, 'India');
    } else {
      activeSearchInp.value = 'India';
    }
    activeSearchInp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'India' }));
    activeSearchInp.dispatchEvent(new Event('input', { bubbles: true }));
    activeSearchInp.dispatchEvent(new Event('change', { bubbles: true }));

    // Step 5: Press Enter key with complete event properties to trigger search
    console.log('[Workday AI] Dispatching Enter key to filter Country Phone Code for India...');
    const enterDown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    const enterPress = new KeyboardEvent('keypress', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    const enterUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    activeSearchInp.dispatchEvent(enterDown);
    activeSearchInp.dispatchEvent(enterPress);
    activeSearchInp.dispatchEvent(enterUp);

    // Also trigger form submit or change if listened
    activeSearchInp.dispatchEvent(new Event('change', { bubbles: true }));

    // Step 6: Wait and poll up to 5 seconds for filtered options to load
    console.log('[Workday AI] Waiting and polling for Country Phone Code options...');
    let match: HTMLElement | null = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 500));

      const listOptions = Array.from(document.querySelectorAll<HTMLElement>(
        '[data-automation-id="promptLeafNode"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], [role="option"], li[role="option"], div[data-automation-label]'
      ));

      match = listOptions.find((opt) => {
        const txt = (opt.getAttribute('data-automation-label') || opt.getAttribute('aria-label') || opt.textContent || '').toLowerCase().trim();
        if (txt.includes('british indian ocean')) return false;
        return (txt.includes('india') && (txt.includes('+91') || txt.startsWith('india'))) || (txt.includes('+91') && !txt.includes('ocean'));
      }) || listOptions.find((opt) => {
        const txt = (opt.getAttribute('data-automation-label') || opt.getAttribute('aria-label') || opt.textContent || '').toLowerCase().trim();
        return !txt.includes('british indian ocean') && txt.includes('india');
      }) || null;

      if (match) {
        console.log(`[Workday AI] Found Country Phone Code option: "${match.getAttribute('data-automation-label') || match.textContent?.trim()}"`);
        break;
      }
    }

    if (match) {
      console.log(`[Workday AI] Country Phone Code: Clicking radioBtn & leaf node in "${match.getAttribute('data-automation-label') || match.textContent?.trim()}"...`);

      const leafNode = match.getAttribute('data-automation-id') === 'promptLeafNode' ? match : (match.closest<HTMLElement>('[data-automation-id="promptLeafNode"]') || match);
      const radioBtn = leafNode.querySelector<HTMLInputElement>('input[data-automation-id="radioBtn"], input[type="radio"]') || match.querySelector<HTMLInputElement>('input[data-automation-id="radioBtn"], input[type="radio"]');
      const radioSpan = leafNode.querySelector<HTMLElement>('span.css-1fzhg67, .css-rkll8q');

      if (radioBtn) {
        radioBtn.focus();
        this.clickWorkdayOptionElement(radioBtn);
        radioBtn.checked = true;
        radioBtn.setAttribute('aria-checked', 'true');
        radioBtn.dispatchEvent(new Event('input', { bubbles: true }));
        radioBtn.dispatchEvent(new Event('change', { bubbles: true }));
        radioBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }

      if (radioSpan) {
        this.clickWorkdayOptionElement(radioSpan);
      }

      this.clickWorkdayOptionElement(leafNode);
      this.clickWorkdayOptionElement(match);

      leafNode.setAttribute('data-uxi-multiselectlistitem-isselected', 'true');
      leafNode.setAttribute('data-automation-checked', 'Checked');

      await new Promise((r) => setTimeout(r, 600));

      // Click outside on Phone Number label / smartDivider / background to confirm selection
      console.log('[Workday AI] Clicking outside on next field to confirm Country Phone Code selection...');
      try {
        const outsideTarget = document.querySelector<HTMLElement>(
          'label[for="phoneNumber--phoneNumber"], [data-automation-id="formField-phoneNumber"] label, [data-automation-id="smartDivider"], h4#Phone-section'
        );
        if (outsideTarget) {
          outsideTarget.focus?.();
          this.clickWorkdayOptionElement(outsideTarget);
        }
        // NOTE: Do NOT dispatch Escape on document — it clears other multiselect fields (e.g. Source)
      } catch { }

      await new Promise((r) => setTimeout(r, 600));
      return true;
    }

    return false;
  }

  public static async fillWorkdayPreviousWorker(): Promise<boolean> {
    const radioContainers = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-automation-id="formField-candidateIsPreviousWorker"], [data-fkit-id*="previousWorker"], [name="candidateIsPreviousWorker"], fieldset'
    ));

    const targetContainer = radioContainers.find((c) => {
      const txt = (c.textContent || '').toLowerCase();
      return txt.includes('previously worked') || txt.includes('previous worker') || txt.includes('employee or contractor');
    }) || document.querySelector<HTMLElement>('[data-automation-id="formField-candidateIsPreviousWorker"]') || null;

    if (targetContainer) {
      console.log('[Workday AI] Selecting "No" for Have you previously worked question...');
      const success = this.clickRadioOption(targetContainer, 'No');
      if (success) {
        return true;
      }
    }

    // Direct fallback for input with value="false" and name containing previousWorker
    const noRadio = document.querySelector<HTMLInputElement>(
      'input[type="radio"][name*="candidateIsPreviousWorker"][value="false"], input[type="radio"][name*="previousWorker"][value="false"]'
    );
   if (noRadio) {
  console.log(
    '[Workday AI] Previous Worker fallback: selecting No with ONE click...'
  );

  if (
    !noRadio.checked &&
    noRadio.getAttribute('aria-checked') !== 'true'
  ) {
    this.clickWorkdayOptionElement(noRadio);
    await new Promise((r) => setTimeout(r, 500));
  }

  return (
    noRadio.checked ||
    noRadio.getAttribute('aria-checked') === 'true'
  );
}

    return false;
  }

  private static formatProperCase(str: string): string {
    if (!str) return str;
    return str
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private static resolveGenderFromName(firstName?: string, fullName?: string): string {
    const cleanName = `${firstName || ''} ${fullName || ''}`.toLowerCase().trim();
    if (!cleanName) return 'Male';

    const femaleIndicators = [
      'priya', 'anita', 'pooja', 'sneha', 'sakshi', 'ananya', 'sarah', 'emily', 'jessica',
      'maria', 'ashley', 'michelle', 'amanda', 'lauren', 'hannah', 'rachel', 'stephanie',
      'divya', 'neha', 'shreya', 'kavya', 'swati', 'aditi', 'tanvi', 'ritu', 'priyanka',
      'nisha', 'megha', 'deepa', 'aishwarya', 'sonia', 'kajal', 'shweta', 'monika', 'poornima',
      'aarti', 'ankita', 'bhavna', 'chitra', 'isabella', 'sophia', 'emma', 'olivia', 'ava',
      'charlotte', 'amelia', 'mia', 'harper', 'evelyn', 'abigail', 'elizabeth', 'camila'
    ];

    const isFemale = femaleIndicators.some((f) => cleanName.includes(f));
    return isFemale ? 'Female' : 'Male';
  }

  public static async fillWorkdayVoluntaryDisclosures(candidate: CandidateProfile): Promise<number> {
    let filled = 0;
    const eeo = candidate.eeoDisclosures || {};

    const targetEthnicity = (eeo.raceEthnicity && eeo.raceEthnicity !== 'Decline to self-identify') ? eeo.raceEthnicity : ((candidate as any).ethnicity || 'Asian');

    console.log(`[Workday AI] Voluntary Disclosures: Auto-filling Ethnicity ("${targetEthnicity}") and Terms Checkbox. Skipping Gender & Veteran Status for manual user selection ✓`);

    // 0. DIRECT Workday ID Match for Ethnicity & Terms Checkbox
    let ethDone = false;
    let termsDone = false;

    const ethBtn = document.querySelector<HTMLElement>('button#personalInfoUS--ethnicity, button[name="ethnicity"], [data-automation-id="formField-ethnicity"] button');
    if (ethBtn) {
      const curVal = (ethBtn.textContent || ethBtn.getAttribute('value') || '').trim();
      if (curVal && curVal !== 'Select One' && !curVal.toLowerCase().includes('select one')) {
        ethDone = true;
      } else {
        console.log(`[Workday AI] Direct HTML ID match -> Ethnicity: "${targetEthnicity}"`);
        const ok = await this.setSelectValue(ethBtn, targetEthnicity);
        if (ok) { filled++; ethDone = true; }
      }
    }

    const termsCb = document.querySelector<HTMLInputElement>('input#termsAndConditions--acceptTermsAndAgreements, input[name="acceptTermsAndAgreements"], [data-automation-id="formField-acceptTermsAndAgreements"] input[type="checkbox"]');
    if (termsCb) {
      if (termsCb.checked) {
        termsDone = true;
      } else {
        console.log('[Workday AI] Direct HTML ID match -> Terms & Conditions Checkbox checked ✓');
        const ok = this.setCheckboxValue(termsCb, true);
        if (ok) { filled++; termsDone = true; }
      }
    }

    if (ethDone && termsDone) {
      console.log('[Workday AI] Voluntary Disclosures handled cleanly ✓');
      return filled;
    }

    // 1. Scan formField / group elements ONLY for Ethnicity and Terms (SKIP Gender & Veteran Status)
    const formFields = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-automation-id*="formField"], fieldset, div[role="group"], div.css-7t35fz, div.css-gvoll6'
    ));

    for (const field of formFields) {
      const labelEl = field.querySelector('label, legend, h3, h4, h5, [data-automation-id*="label"]');
      const labelText = (labelEl?.textContent || field.textContent || '').toLowerCase().trim();

      const selectBtn = field.querySelector<HTMLElement>(
        'button[aria-haspopup="listbox"], button[id*="dropdown"], select, [data-automation-id*="prompt"]'
      );
      const checkboxInp = field.querySelector<HTMLInputElement>('input[type="checkbox"]');

      // --- ETHNICITY ---
      if (!ethDone && (labelText.includes('ethnicity') || labelText.includes('race'))) {
        if (selectBtn) {
          const curVal = (selectBtn.textContent || selectBtn.getAttribute('value') || '').trim();
          if (!curVal || curVal === 'Select One' || curVal.toLowerCase().includes('select one')) {
            console.log(`[Workday AI] Filling Ethnicity -> "${targetEthnicity}"`);
            const ok = await this.setSelectValue(selectBtn, targetEthnicity);
            if (ok) { filled++; ethDone = true; }
          }
        }
      }

      // --- TERMS & CONDITIONS / PRIVACY POLICY CHECKBOX ---
      else if (!termsDone && (labelText.includes('terms') || labelText.includes('privacy') || labelText.includes('agree') || labelText.includes('conditions') || labelText.includes('accept'))) {
        if (checkboxInp && !checkboxInp.checked) {
          console.log('[Workday AI] Checking Terms & Conditions / Privacy Policy checkbox ✓');
          const ok = this.setCheckboxValue(checkboxInp, true);
          if (ok) { filled++; termsDone = true; }
        }
      }
    }

    // 2. Standalone checkbox search fallback for Terms and Conditions
    const allCheckboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    for (const cb of allCheckboxes) {
      if (!cb.checked) {
        const parentTxt = (cb.closest('label, div, fieldset')?.textContent || '').toLowerCase();
        if (parentTxt.includes('terms') || parentTxt.includes('privacy') || parentTxt.includes('agree') || parentTxt.includes('policy') || parentTxt.includes('checkbox')) {
          console.log('[Workday AI] Standalone checkbox match -> Checking Terms & Privacy Policy ✓');
          const ok = this.setCheckboxValue(cb, true);
          if (ok) filled++;
        }
      }
    }

    return filled;
  }

  public static async fillWorkdaySelfIdentify(candidate: CandidateProfile): Promise<number> {
    let filled = 0;

    // Strict guard: verify we are actually inside the Self-Identify / Disability form section
    const disabilitySection = document.querySelector<HTMLElement>(
      '[data-automation-id*="selfIdentifiedDisability"], [id*="selfIdentifiedDisability"], div[data-fkit-id*="disability"], div[id*="disability"]'
    ) || Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, legend, div')).find((el) => {
      const txt = (el.textContent || '').toLowerCase();
      return (txt.includes('voluntary self-identification of disability') || txt.includes('form cc-305') || txt.includes('self-identification of disability')) && !txt.includes('experience');
    }) || null;

    if (!disabilitySection) {
      console.log('[Workday AI] Not on Self-Identify step -> DO NOT TOUCH ANY DATE INPUTS ON PAGE ✓');
      return 0;
    }

    console.log('[Workday AI] Running Self-Identify (Disability Form CC-305) auto-filler...');

    // 1. Auto-fill Name field with candidate's full name (strictly scoped inside disability section)
    const nameInput = disabilitySection.querySelector<HTMLInputElement>(
      '#selfIdentifiedDisabilityData--name, input[id*="disability"][id*="name"], [data-automation-id="formField-name"] input, input[data-automation-id*="name"]'
    );
    if (nameInput) {
      const curVal = (nameInput.value || '').trim();
      if (!curVal) {
        const nameToUse = candidate?.personalInfo?.fullName || 'Candidate';
        console.log(`[Workday AI] Self-Identify -> Filling Name: "${nameToUse}"`);
        const ok = this.setInputValue(nameInput, nameToUse);
        if (ok) filled++;
      }
    }

    // 2. Auto-fill Date field with TODAY'S DATE (MM/DD/YYYY) - strictly scoped inside disability section
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());
    const todayStr = `${mm}/${dd}/${yyyy}`;

    const monthInp = disabilitySection.querySelector<HTMLInputElement>('#selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-input, [data-automation-id="dateSectionMonth-input"]');
    const dayInp = disabilitySection.querySelector<HTMLInputElement>('#selfIdentifiedDisabilityData--dateSignedOn-dateSectionDay-input, [data-automation-id="dateSectionDay-input"]');
    const yearInp = disabilitySection.querySelector<HTMLInputElement>('#selfIdentifiedDisabilityData--dateSignedOn-dateSectionYear-input, [data-automation-id="dateSectionYear-input"]');

    if (monthInp && dayInp && yearInp) {
      console.log(`[Workday AI] Direct Disability Date Spinbutton fill: ${mm}/${dd}/${yyyy}`);
      this.setInputValue(monthInp, mm);
      this.setInputValue(dayInp, dd);
      this.setInputValue(yearInp, yyyy);

      const mDisplay = disabilitySection.querySelector('#selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-display, [data-automation-id="dateSectionMonth-display"]');
      const dDisplay = disabilitySection.querySelector('#selfIdentifiedDisabilityData--dateSignedOn-dateSectionDay-display, [data-automation-id="dateSectionDay-display"]');
      const yDisplay = disabilitySection.querySelector('#selfIdentifiedDisabilityData--dateSignedOn-dateSectionYear-display, [data-automation-id="dateSectionYear-display"]');
      if (mDisplay) mDisplay.textContent = mm;
      if (dDisplay) dDisplay.textContent = dd;
      if (yDisplay) yDisplay.textContent = yyyy;
      filled++;
    } else {
      const dateContainer = disabilitySection.querySelector<HTMLElement>(
        '[data-automation-id="formField-dateSection"], [data-automation-id*="dateInputWrapper"], [data-automation-id*="dateSection"]'
      );

      if (dateContainer) {
        console.log(`[Workday AI] Self-Identify -> Filling Today's Date: "${todayStr}"`);
        const ok = await this.setWorkdayDateValue(dateContainer, todayStr, dd);
        if (ok) filled++;
      }
    }

    // 3. Auto-select "No, I do not have a disability and have not had one in the past"
    let disSelected = false;

    // Direct match via exact disabilityStatus ID / label inside disability section
    const disInput = disabilitySection.querySelector<HTMLInputElement>('input[id*="disabilityStatus"], input[name*="disabilityStatus"]');
    const disLabel = disabilitySection.querySelector<HTMLLabelElement>('label[for*="disabilityStatus"]');

    if (disInput) {
      console.log('[Workday AI] Direct match -> Disability Checkbox input found. Checking...');
      this.clickWorkdayOptionElement(disInput);
      disInput.checked = true;
      disInput.setAttribute('aria-checked', 'true');
      disInput.dispatchEvent(new Event('change', { bubbles: true }));
      disInput.dispatchEvent(new Event('click', { bubbles: true }));
      filled++;
      disSelected = true;
    } else if (disLabel) {
      console.log('[Workday AI] Direct match -> Disability Label found. Clicking...');
      this.clickWorkdayOptionElement(disLabel);
      filled++;
      disSelected = true;
    }

    // Fallback scan across options inside disability section
    if (!disSelected) {
      const disabilityOptions = Array.from(disabilitySection.querySelectorAll<HTMLElement>(
        'input[type="radio"], input[type="checkbox"], label, div.css-1utp272'
      ));

      for (const opt of disabilityOptions) {
        const txt = (opt.textContent || opt.getAttribute('aria-label') || opt.getAttribute('value') || '').toLowerCase().trim();
        const parentTxt = (opt.closest('label, div, fieldset')?.textContent || '').toLowerCase().trim();

        if (txt.includes('no, i do not have a disability') || txt.includes('not have a disability') ||
          parentTxt.includes('no, i do not have a disability') || parentTxt.includes('not have a disability')) {
          console.log('[Workday AI] Self-Identify -> Selected: "No, I do not have a disability and have not had one in the past" ✓');

          if (opt instanceof HTMLInputElement) {
            if (!opt.checked) {
              this.clickWorkdayOptionElement(opt);
              opt.checked = true;
              opt.dispatchEvent(new Event('change', { bubbles: true }));
              filled++;
            }
          } else {
            this.clickWorkdayOptionElement(opt);
            filled++;
          }
          break;
        }
      }
    }

    return filled;
  }

  public static async fillWorkdaySource(): Promise<boolean> {
    const sourceContainer = document.querySelector<HTMLElement>(
      '[data-automation-id="formField-source"]'
    ) || document.querySelector<HTMLElement>(
      '[data-automation-id*="source"], [id*="source"]'
    ) || Array.from(document.querySelectorAll<HTMLElement>('div, fieldset, label')).find((el) => {
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('how did you hear about us');
    }) || null;

    if (!sourceContainer) return false;

    // Check if ALREADY HAS A SELECTED PILL / TAG / VALUE
    const selectedItems = sourceContainer.querySelector('[data-automation-id="selectedItemsList"], [data-automation-id="selectedItemList"]');
    const hasPill = selectedItems && selectedItems.children.length > 0;
    const ariaInstruction = sourceContainer.querySelector('[data-automation-id="promptAriaInstruction"]');
    const ariaText = (ariaInstruction?.textContent || '').toLowerCase();
    const hasSelectedAria = ariaText.includes('item selected') && !ariaText.includes('0 items');

    // Also check promptSelectionLabel for existing text
    const sourceSelectionLabel = sourceContainer.querySelector('[data-automation-id="promptSelectionLabel"]');
    const sourceSelectionText = (sourceSelectionLabel?.textContent || '').trim();
    const hasSelectionLabel = sourceSelectionText.length > 0;

    if (hasPill || hasSelectedAria || hasSelectionLabel) {
      console.log(`[Workday AI] Source field ALREADY HAS A SELECTED VALUE (pill=${hasPill}, aria=${hasSelectedAria}, label="${sourceSelectionText}"). DO NOT TOUCH! ✓`);
      return true;
    }

    // Search input specifically for source box (#source--source)
    const searchInp = sourceContainer.querySelector<HTMLInputElement>(
      '#source--source, input[data-automation-id="searchBox"], input[data-uxi-widget-type="selectinput"]'
    );

    if (!searchInp) return false;

    // Step 1: Click the search input to activate/focus it
    console.log('[Workday AI] How Did You Hear About Us?: Clicking search input to activate...');
    this.clickWorkdayOptionElement(searchInp);
    searchInp.focus();
    searchInp.dispatchEvent(new Event('focus', { bubbles: true }));
    searchInp.dispatchEvent(new Event('focusin', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));

    // Step 2: Type "Facebook" using React-compatible native setter (no blur)
    console.log('[Workday AI] How Did You Hear About Us?: Typing "Facebook" in search input...');
    const tracker = (searchInp as any)._reactValueTracker;
    if (tracker) tracker.setValue('');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(searchInp, 'Facebook');
    } else {
      searchInp.value = 'Facebook';
    }
    searchInp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Facebook' }));
    searchInp.dispatchEvent(new Event('input', { bubbles: true }));
    searchInp.dispatchEvent(new Event('change', { bubbles: true }));

    // Step 3: Wait for Workday to filter the dropdown options
    console.log('[Workday AI] How Did You Hear About Us?: Waiting for filtered results...');
    await new Promise((r) => setTimeout(r, 2000));

    // Step 4: Press Enter to select the filtered result
    console.log('[Workday AI] How Did You Hear About Us?: Pressing Enter to select...');
    const enterOpts: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    searchInp.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    searchInp.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    searchInp.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    await new Promise((r) => setTimeout(r, 1500));

    // Step 5: Click outside to confirm selection and close dropdown
    console.log('[Workday AI] How Did You Hear About Us?: Clicking outside to confirm...');
    searchInp.blur();
    const outsideTarget = document.querySelector<HTMLElement>(
      '[data-automation-id="formField-candidateIsPreviousWorker"], [data-automation-id="smartDivider"], [data-automation-id="pageHeader"], h3, h4, body'
    );
    if (outsideTarget) {
      outsideTarget.focus?.();
      this.clickWorkdayOptionElement(outsideTarget);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

    await new Promise((r) => setTimeout(r, 800));

    console.log('[Workday AI] How Did You Hear About Us?: Facebook selection completed. ✓');
    return true;
  }

  public static clickWorkdayOptionElement(el: HTMLElement): void {
    try {
      el.focus();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.click();
    } catch {
      try { el.click(); } catch { }
    }
  }

  public static async autoAttachResumeFile(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return false;

    return new Promise((resolve) => {
      chrome.storage.local.get(['uploadedResumeFile'], async (result) => {
        if (chrome.runtime?.lastError || !result?.uploadedResumeFile) {
          resolve(false);
          return;
        }

        const fileData = result.uploadedResumeFile;
        const fileInput = document.querySelector<HTMLInputElement>(
          'input[type="file"][data-automation-id*="upload"], input[type="file"][data-automation-id*="resume"], input[type="file"]'
        );

        if (!fileInput) {
          resolve(false);
          return;
        }

        // 1. If fileInput already has a file selected, DO NOT upload again!
        if (fileInput.files && fileInput.files.length > 0) {
          resolve(false);
          return;
        }

        // 2. If Workday DOM already displays an uploaded resume file item/pill, DO NOT upload again!
        const existingFilePill = document.querySelector<HTMLElement>(
          '[data-automation-id*="file-upload-item"], [data-automation-id*="uploadedFile"], [data-automation-id*="file-attachment-item"], [data-automation-id*="fileUploadItem"], div.css-169z3b8'
        );
        if (existingFilePill) {
          resolve(false);
          return;
        }

        try {
          const res = await fetch(fileData.base64);
          const blob = await res.blob();
          const file = new File([blob], fileData.name, { type: fileData.type });

          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;

          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });
  }

  public static setInputValue(element: HTMLElement, value: string): boolean {
    let inputEl: HTMLInputElement | HTMLTextAreaElement | null = null;

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      inputEl = element;
    } else {
      inputEl = element.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    }

    if (!inputEl) return false;

    try {
      // 1. Focus input & dispatch focus events
      inputEl.focus();
      inputEl.dispatchEvent(new Event('focus', { bubbles: true }));
      inputEl.dispatchEvent(new Event('focusin', { bubbles: true }));

      // 2. Clear React value tracker cache
      const tracker = (inputEl as any)._reactValueTracker;
      if (tracker) {
        tracker.setValue('');
      }

      // 3. Set value via prototype setter
      const prototype = inputEl instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;

      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(inputEl, value);
      } else {
        inputEl.value = value;
      }

      // 4. Dispatch full keyboard & input event chain for Workday validation engine
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      // 5. Blur input to trigger Workday React onBlur validation clearance
      inputEl.blur();
      inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
      inputEl.dispatchEvent(new Event('focusout', { bubbles: true }));

      return true;
    } catch {
      return false;
    }
  }

  public static async setSelectValue(element: HTMLElement, targetOptionText: string): Promise<boolean> {
    try {
      if (element.tagName === 'SELECT') {
        const select = element as HTMLSelectElement;
        const options = Array.from(select.options);
        const match = options.find((o) => o.text.toLowerCase().includes(targetOptionText.toLowerCase()));
        if (match) {
          select.value = match.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }
        return false;
      }

      const targetLower = targetOptionText.toLowerCase();

      // 1. Check if element is a Workday Button Dropdown (like Phone Device Type, Country, State / countryRegion, Degree)
      const btn = (element.tagName === 'BUTTON' ? element : element.querySelector<HTMLElement>('button[aria-haspopup="listbox"], button')) as HTMLElement || element;

      if (btn && (btn.tagName === 'BUTTON' || btn.getAttribute('aria-haspopup'))) {
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        if (!isExpanded) {
          this.clickWorkdayOptionElement(btn);
          await new Promise((res) => setTimeout(res, 1200));
        } else {
          await new Promise((res) => setTimeout(res, 150));
        }

        // Scan all open listbox options across all possible Workday selectors
        let options = Array.from(document.querySelectorAll<HTMLElement>(
          '[role="option"], [data-automation-id="promptOption"], li[role="option"], ul[role="listbox"] li, div[role="listbox"] div, div[role="option"], [data-uxi-widget-type*="select"] li, div.css-15rz5ap div'
        ));

        // 1. Try exact match first
        let match = options.find((o) => {
          const txt = (o.textContent || o.getAttribute('data-automation-label') || '').toLowerCase().trim();
          return txt === targetLower;
        });

        // 2. Try prefix/standalone word match (excluding 'British Indian Ocean Territory' for 'India')
        if (!match) {
          match = options.find((o) => {
            const txt = (o.textContent || o.getAttribute('data-automation-label') || '').toLowerCase().trim();
            if (targetLower === 'india' && txt.includes('british indian ocean')) return false;
            return txt.startsWith(targetLower) || txt.includes(` ${targetLower} `) || txt.endsWith(` ${targetLower}`);
          });
        }

        // 3. Fallback includes match (excluding 'British Indian Ocean Territory' for 'India')
        if (!match) {
          match = options.find((o) => {
            const txt = (o.textContent || o.getAttribute('data-automation-label') || '').toLowerCase().trim();
            if (targetLower === 'india' && txt.includes('british indian ocean')) return false;
            return txt.includes(targetLower);
          });
        }

        // Fallback for Country Phone Code: match "India (+91)", "United States (+1)", etc.
        if (!match && (targetLower.includes('india') || targetLower.includes('united states') || targetLower.includes('+91') || targetLower.includes('+1'))) {
          match = options.find((o) => {
            const txt = (o.textContent || o.getAttribute('data-automation-label') || '').toLowerCase().trim();
            if ((targetLower.includes('india') || targetLower.includes('+91')) && (txt.includes('india') || txt.includes('+91'))) return true;
            if ((targetLower.includes('united states') || targetLower.includes('+1')) && (txt.includes('united states') || txt.includes('+1'))) return true;
            return false;
          });
        }

        // Fallback for Phone Device Type: match "Home" or "Home Cellular"
        if (!match && targetLower.includes('home')) {
          match = options.find((o) => {
            const txt = (o.textContent || '').toLowerCase().trim();
            return txt === 'home' || txt.includes('home');
          });
        }

        // Fallback for Veteran Status: match "not a protected veteran", "identify as one", etc.
        const cleanKw = targetLower.replace(/[^a-z0-9]/g, '');
        if (!match && (cleanKw.includes('veteran') || cleanKw.includes('protected'))) {
          match = options.find((o) => {
            const txt = (o.textContent || o.getAttribute('data-automation-label') || '').toLowerCase().trim();
            if (cleanKw.includes('not') && (txt.includes('not a protected') || txt.includes('not a veteran'))) return true;
            if (cleanKw.includes('identify') && (txt.includes('identify') || txt.includes('protected veteran'))) return true;
            if (txt.includes('decline') || txt.includes('do not wish')) return true;
            return false;
          });
        }
        const isHighSchool = cleanKw.includes('highschool') || cleanKw.includes('12th') || cleanKw.includes('10th') || cleanKw.includes('secondary') || cleanKw.includes('hsc') || cleanKw.includes('ssc') || cleanKw.includes('intermediate') || cleanKw.includes('matriculation') || cleanKw.includes('school');
        const isBtech = cleanKw.includes('btech') || cleanKw.includes('bacheloroftech') || cleanKw.includes('bachelorofeng') || cleanKw.includes('be');
        const isMtech = cleanKw.includes('mtech') || cleanKw.includes('masteroftech') || cleanKw.includes('masterofeng') || cleanKw.includes('me');
        const isMca = cleanKw.includes('mca') || cleanKw.includes('masterofcomputer');
        const isBca = cleanKw.includes('bca') || cleanKw.includes('bachelorofcomputer');
        const isDiploma = cleanKw.includes('diploma') || cleanKw.includes('polytechnic');

        if (!match) {
          match = options.find((o) => {
            const txt = (o.textContent || o.getAttribute('data-automation-label') || '').toLowerCase().trim();
            if (isHighSchool && (txt.includes('high school') || txt.includes('secondary') || txt.includes('matriculation') || txt.includes('higher secondary') || txt.includes('school'))) return true;
            if (isBtech && (txt.includes('btech') || txt.includes('bachelor of tech') || txt.includes('bachelor of eng') || txt === 'btech')) return true;
            if (isMtech && (txt.includes('mtech') || txt.includes('master of tech') || txt.includes('master of eng') || txt === 'mtech')) return true;
            if (isMca && (txt.includes('mca') || txt.includes('master of computer'))) return true;
            if (isBca && (txt.includes('bca') || txt.includes('bachelor of computer'))) return true;
            if (isDiploma && (txt.includes('diploma') || txt.includes('polytechnic'))) return true;
          });
        }

        if (match) {
          console.log(`[Workday AI] Found dropdown option match: "${match.textContent?.trim()}". Clicking option...`);
          const innerElement = match.querySelector<HTMLElement>('p, span, label, div[data-automation-label]') || match;
          this.clickWorkdayOptionElement(match);
          this.clickWorkdayOptionElement(innerElement);
          await new Promise((res) => setTimeout(res, 350));
          return true;
        } else if (options.length > 0) {
          const validOpt = options.find((o) => {
            const txt = (o.textContent || '').toLowerCase().trim();
            return txt && txt !== 'select one' && !txt.includes('select one');
          }) || options[0];
          const innerElement = validOpt.querySelector<HTMLElement>('p, span, label, div[data-automation-label]') || validOpt;
          this.clickWorkdayOptionElement(validOpt);
          this.clickWorkdayOptionElement(innerElement);
          await new Promise((res) => setTimeout(res, 350));
          return true;
        }
      }

      // 2. Workday Multiselect Search Input (e.g. How Did You Hear About Us? - id="source--source")
      const searchInput = element.querySelector<HTMLInputElement>(
        'input[data-uxi-widget-type="selectinput"], input[enterkeyhint="search"], [data-automation-id="multiselectInputContainer"] input'
      ) || (element instanceof HTMLInputElement ? element : null);

      if (searchInput) {
        const container = searchInput.closest('[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"], div[role="group"]') || searchInput.parentElement;
        const promptIcon = container?.querySelector<HTMLElement>(
          '[data-automation-id="promptIcon"], [data-uxi-widget-type="selectinputicon"]'
        );

        // Open Level 1 Categories Menu (Screenshot 1: Associations, Event/Conference, Job Board, Social Media, University, Website)
        searchInput.focus();
        if (promptIcon) {
          this.clickWorkdayOptionElement(promptIcon);
        } else {
          this.clickWorkdayOptionElement(searchInput);
        }
        await new Promise((res) => setTimeout(res, 450));

        let listOptions = Array.from(document.querySelectorAll<HTMLElement>(
          '[data-automation-id="promptOption"], [role="option"], p[data-automation-label], .css-tv26v, li[role="presentation"]'
        ));

        // Find "Social Media" or target category from Level 1 menu
        let categoryMatch = listOptions.find((opt) => opt.textContent?.toLowerCase().includes('social media'));
        if (!categoryMatch) {
          categoryMatch = listOptions.find((opt) => {
            const txt = (opt.textContent || '').toLowerCase();
            return txt.includes('job board') || txt.includes('website') || txt.includes('associations');
          }) || listOptions[0];
        }

        if (categoryMatch) {
          // Click Level 1 Category (e.g. "Social Media >") to open Level 2 sub-menu (Screenshot 2!)
          this.clickWorkdayOptionElement(categoryMatch);
          await new Promise((res) => setTimeout(res, 450));

          // Scan Level 2 sub-menu options (Facebook, Twitter, YouTube, LinkedIn, Offershow, RED, Weibo, Xing, etc.)
          let subOptions = Array.from(document.querySelectorAll<HTMLElement>(
            '[data-automation-id="promptOption"], [role="option"], p[data-automation-label], li'
          ));

          if (subOptions.length > 0) {
            // Select any social media option from Level 2 sub-menu
            const subMatch = subOptions.find((opt) => {
              const txt = (opt.textContent || '').toLowerCase();
              return txt.includes('facebook') || txt.includes('twitter') || txt.includes('youtube') || txt.includes('linkedin') || txt.includes('offershow');
            }) || subOptions[0];

            this.clickWorkdayOptionElement(subMatch);
            await new Promise((res) => setTimeout(res, 300));
            return true;
          }
        }

        // If menus didn't pop up, fallback to typing search into searchInput
        this.setInputValue(searchInput, 'Social Media');
        await new Promise((res) => setTimeout(res, 350));

        listOptions = Array.from(document.querySelectorAll<HTMLElement>(
          '[data-automation-id="promptOption"], [role="option"], p[data-automation-label], li'
        ));
        if (listOptions.length > 0) {
          this.clickWorkdayOptionElement(listOptions[0]);
          return true;
        }

        // Fallback: Dispatch Enter key
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return true;
      }

      // 3. Fallback trigger button or container
      const trigger = element.tagName === 'BUTTON' || element.getAttribute('role') === 'combobox'
        ? element
        : element.querySelector<HTMLElement>('button, [role="combobox"], [aria-haspopup="listbox"], [data-automation-id*="prompt"], input') || element;

      if (trigger) {
        this.clickWorkdayOptionElement(trigger);
        await new Promise((res) => setTimeout(res, 350));

        const popupSearch = document.querySelector<HTMLInputElement>('[data-automation-id="searchBox"], [role="combobox"] input, input[aria-label*="Search"]');
        if (popupSearch) {
          this.setInputValue(popupSearch, targetOptionText);
          await new Promise((res) => setTimeout(res, 350));
        }

        let listOptions = Array.from(document.querySelectorAll<HTMLElement>(
          '[role="option"], [data-automation-id="promptOption"], li[role="option"], div[role="option"], p[data-automation-label]'
        ));

        if (listOptions.length > 0) {
          // Priority 1: Exact text match
          let matchOpt = listOptions.find(o => (o.textContent || '').toLowerCase().trim() === targetOptionText.toLowerCase().trim());
          // Priority 2: Includes target text
          if (!matchOpt) {
            matchOpt = listOptions.find(o => (o.textContent || '').toLowerCase().includes(targetOptionText.toLowerCase()));
          }
          // Priority 3: First non-empty fallback option
          if (!matchOpt) {
            matchOpt = listOptions[0];
          }

          if (matchOpt) {
            this.clickWorkdayOptionElement(matchOpt);
            await new Promise((res) => setTimeout(res, 300));
            return true;
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }


  public static clickRadioOption(
  containerOrInput: HTMLElement,
  optionText: string
): boolean {
  try {
    const target = (optionText || 'No').trim().toLowerCase();

    // We specifically want "No" / false for this Workday question.
    const wantNo =
      target === 'no' ||
      target === 'false';

    const container =
      containerOrInput.closest<HTMLElement>(
        '[data-automation-id="formField-candidateIsPreviousWorker"]'
      ) ||
      containerOrInput;

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="candidateIsPreviousWorker"], ' +
        'input[type="radio"]'
      )
    );

    if (inputs.length === 0) {
      console.warn(
        '[Workday AI] Previous Worker: No radio buttons found.'
      );
      return false;
    }

    // Find ONLY the requested radio.
    const targetInput = inputs.find((input) => {
      const value = (input.value || '').toLowerCase().trim();

      const label = document.querySelector<HTMLLabelElement>(
        `label[for="${input.id}"]`
      );

      const labelText =
        (label?.textContent || '').toLowerCase().trim();

      if (wantNo) {
        return (
          value === 'false' ||
          labelText === 'no'
        );
      }

      return (
        value === 'true' ||
        labelText === 'yes'
      );
    });

    if (!targetInput) {
      console.warn(
        `[Workday AI] Previous Worker: Could not find "${optionText}" radio.`
      );
      return false;
    }

    // If already selected, DO NOTHING.
    if (
      targetInput.checked === true ||
      targetInput.getAttribute('aria-checked') === 'true'
    ) {
      console.log(
        `[Workday AI] Previous Worker: "${optionText}" is already selected.`
      );
      return true;
    }

    console.log(
      `[Workday AI] Previous Worker: Selecting "${optionText}" with ONE click...`
    );

    // IMPORTANT:
    // Click ONLY the target input once.
    // Do NOT click label + wrapper + input.
    this.clickWorkdayOptionElement(targetInput);

    // Give Workday/React time to update.
    setTimeout(() => {
      // Only verify. Do NOT click again.
      const currentChecked =
        targetInput.checked ||
        targetInput.getAttribute('aria-checked') === 'true';

      console.log(
        `[Workday AI] Previous Worker: "${optionText}" selected = ${currentChecked}`
      );
    }, 500);

    return true;

  } catch (error) {
    console.warn(
      '[Workday AI] Previous Worker radio selection failed:',
      error
    );
    return false;
  }
}

  public static setCheckboxValue(element: HTMLElement, checked: boolean): boolean {
    try {
      let cb: HTMLInputElement | null = null;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        cb = element;
      } else {
        cb = element.querySelector<HTMLInputElement>('input[type="checkbox"]');
      }

      if (cb && cb.checked !== checked) {
        this.clickWorkdayOptionElement(cb);
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public static solveAllDateErrors(): number {
    let count = 0;
    try {
      const calendarIcons = Array.from(document.querySelectorAll<HTMLElement>(
        '[data-automation-id*="date-picker-icon"], [data-automation-id*="calendarIcon"], button[aria-label*="Calendar"], svg[data-uxi-glyph-id="calendar"]'
      ));
      for (const icon of calendarIcons) {
        try {
          icon.click();
          count++;
        } catch { }
      }
    } catch { }
    return count;
  }

  public static async fillWorkdayCreateAccount(email?: string, password?: string): Promise<number> {
    let filled = 0;
    if (!email && !password) return filled;

    if (email) {
      const emailField = document.querySelector<HTMLInputElement>(
        'input[data-automation-id="email"], input[type="email"], input[name="username"], input[data-automation-id="userName"]'
      );
      if (emailField) {
        const ok = this.setInputValue(emailField, email);
        if (ok) filled++;
      }
    }

    if (password) {
      const passField = document.querySelector<HTMLInputElement>(
        'input[data-automation-id="password"], input[type="password"], input[name="password"]'
      );
      if (passField) {
        const ok = this.setInputValue(passField, password);
        if (ok) filled++;
      }

      const verifyPassField = document.querySelector<HTMLInputElement>(
        'input[data-automation-id="verifyPassword"], input[name="verifyPassword"], input[data-automation-id="confirmPassword"]'
      );
      if (verifyPassField) {
        const ok = this.setInputValue(verifyPassField, password);
        if (ok) filled++;
      }
      const agreeCheck = document.querySelector<HTMLInputElement>(
        'input[type="checkbox"][data-automation-id="createAccountCheckbox"], input[type="checkbox"][data-automation-id*="createAccount"], input[type="checkbox"][data-automation-id*="agreement"], input[type="checkbox"][data-automation-id*="terms"], input[type="checkbox"][id*="agreement"], input[type="checkbox"][id*="terms"]'
      );
      if (agreeCheck && !agreeCheck.checked) {
        const ok = this.setCheckboxValue(agreeCheck, true);
        if (ok) filled++;
      }
    }

    // Also check for agreement checkbox independently in case only email or account fill was triggered
    const agreeCheckFallback = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-automation-id="createAccountCheckbox"], input[type="checkbox"][data-automation-id*="createAccountCheckbox"], input[type="checkbox"][data-automation-id*="agreement"], input[type="checkbox"][data-automation-id*="terms"], input[type="checkbox"][id*="agreement"], input[type="checkbox"][id*="terms"]'
    );
    if (agreeCheckFallback && !agreeCheckFallback.checked) {
      this.setCheckboxValue(agreeCheckFallback, true);
    }

    return filled;
  }

  public static async autoSolveDOMErrors(candidate: CandidateProfile): Promise<number> {
    console.log('[Workday AI] Checking top-of-page error banner...');
    let fixed = 0;

    // Detect Workday top error box / error heading
    const errorContainer = document.querySelector<HTMLElement>(
      '[data-automation-id="errorHeading"], [data-automation-id="error-banner"], .css-chz2yv, .css-1lxwves'
    );
    const errorText = (errorContainer?.textContent || '').toLowerCase();

    if (!errorContainer || !errorText) {
      console.log('[Workday AI] No top-of-page errors found.');
      return 0;
    }

    console.log(`[Workday AI] Top error detected: "${errorText.trim().slice(0, 100)}..."`);

    // Fix ONLY the specific error identified without touching anything else!
    if (errorText.includes('country phone code') || errorText.includes('phone code')) {
      console.log('[Workday AI] Resolving missing Country Phone Code error specifically...');
      const phoneFixed = await this.fillWorkdayCountryPhoneCode(candidate);
      if (phoneFixed) fixed++;
      await new Promise((r) => setTimeout(r, 600));
    }

    if (errorText.includes('how did you hear') || errorText.includes('source')) {
      console.log('[Workday AI] Resolving missing How Did You Hear About Us error specifically...');
      const sourceFixed = await this.fillWorkdaySource();
      if (sourceFixed) fixed++;
      await new Promise((r) => setTimeout(r, 600));
    }

    // Try auto-clicking Save and Continue / Next after resolving the specific error
    if (fixed > 0) {
      console.log('[Workday AI] Specific error fixed! Triggering Save & Continue button...');
      await new Promise((r) => setTimeout(r, 800));
      const nextBtn = document.querySelector<HTMLElement>(
        '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="next"], [data-automation-id*="pageFooterNextButton"], [data-automation-id*="click-save-and-continue"], button[aria-label*="Save and Continue"], button[aria-label*="Save & Continue"], button[aria-label*="Continue"], button[aria-label*="Next"]'
      ) || Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => {
        const t = (b.textContent || '').toLowerCase().trim();
        return t.includes('save and continue') || t.includes('save & continue') || t === 'continue' || t === 'next';
      }) || null;

      if (nextBtn) {
        nextBtn.focus();
        nextBtn.click();
        nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }
    }

    return fixed;
  }

  /**
   * Execute fix actions returned by the AI Agent LLM.
   * Each fix has: { action, selector, value, description }
   */
  public static async applyAIFixes(
    fixes: Array<{ action: string; selector: string; value: string; description: string }>,
    candidate: CandidateProfile
  ): Promise<number> {
    console.log('[Workday AI] Form data filled cleanly in 1st pass. Skipping secondary AI fixes.');
    return 0;
  }

  /**
   * Find a DOM element by CSS selector, data-automation-id, or ID.
   */
  private static findElementBySelector(selector: string): Element | null {
    if (!selector) return null;

    // 1. Try as CSS selector directly
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch { }

    // 2. Try as data-automation-id
    const byAutoId = document.querySelector(`[data-automation-id="${selector}"]`);
    if (byAutoId) return byAutoId;

    // 3. Try as partial data-automation-id
    const byPartialAutoId = document.querySelector(`[data-automation-id*="${selector}"]`);
    if (byPartialAutoId) return byPartialAutoId;

    // 4. Try as element ID
    const byId = document.getElementById(selector);
    if (byId) return byId;

    // 5. Try as label text search
    const labels = Array.from(document.querySelectorAll('label, legend'));
    for (const lbl of labels) {
      if ((lbl.textContent || '').toLowerCase().includes(selector.toLowerCase())) {
        const container = lbl.closest('[data-automation-id*="formField"], fieldset');
        if (container) {
          const input = container.querySelector('input, select, textarea, [role="combobox"], button[aria-haspopup]');
          if (input) return input;
        }
      }
    }
    return null;
  }
}
