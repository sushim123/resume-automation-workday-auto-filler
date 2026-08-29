import { WorkdayFormField } from '../types';

export class WorkdayParser {
  public static extractFormFields(): WorkdayFormField[] {
    const fields: WorkdayFormField[] = [];

    // Target strictly interactive input elements
    const elements = document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"], button[id*="dropdown"], button[data-automation-id*="prompt"], [role="radiogroup"]'
    );

    let idCounter = 1;

    elements.forEach((el) => {
      // Skip invisible elements unless aria-haspopup
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.getAttribute('aria-haspopup')) {
        return;
      }

      const autoId = el.getAttribute('data-automation-id') || el.id || '';

      // Skip file dropzones and submit navigation elements
      if (autoId.includes('file-upload') || autoId.includes('bottom-navigation') || autoId.includes('submit')) {
        return;
      }

      let labelText = '';

      // 1. Check label for ID
      if (el.id) {
        const labelEl = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
        if (labelEl) labelText = labelEl.textContent || '';
      }

      // 2. Check parent container for label
      if (!labelText) {
        const parentFormField = el.closest('[data-automation-id*="formField"], [data-automation-id*="formFieldContainer"], div[role="group"], fieldset');
        if (parentFormField) {
          const labelEl = parentFormField.querySelector('label, [data-automation-id*="label"], legend, h3, h4, h5, .css-1h50x5n');
          if (labelEl) labelText = labelEl.textContent || '';
        }
      }

      // 3. Fallback to attributes
      if (!labelText) {
        labelText = el.getAttribute('aria-label') || el.getAttribute('placeholder') || autoId || '';
      }

      labelText = labelText.replace(/\*/g, '').trim();
      if (!labelText && !autoId) return;

      const fieldId = el.id || `workday-field-${idCounter++}`;
      if (!el.id) el.id = fieldId;

      let fieldType: WorkdayFormField['type'] = 'text';
      let options: string[] = [];

      const tagName = el.tagName.toUpperCase();
      const inputType = (el as HTMLInputElement).type?.toLowerCase();

      if (tagName === 'SELECT') {
        fieldType = 'select';
        options = Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).filter(Boolean);
      } else if (inputType === 'radio' || el.getAttribute('role') === 'radiogroup') {
        fieldType = 'radio';
        const radioContainer = el.closest('[data-automation-id*="formField"], fieldset, [role="radiogroup"]') || el.parentElement;
        const radioLabels = radioContainer ? radioContainer.querySelectorAll('label, span, div[class*="utp"]') : [];
        options = Array.from(radioLabels)
          .map((r) => r.textContent?.trim() || '')
          .filter((t) => t && t.length < 100 && !t.includes('?'));
      } else if (inputType === 'checkbox') {
        fieldType = 'checkbox';
        options = ['Selected (Agree)', 'Unselected'];
      } else if (tagName === 'TEXTAREA') {
        fieldType = 'textarea';
      } else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || autoId.includes('select') || autoId.includes('dropdown') || autoId.includes('prompt')) {
        fieldType = 'select';

        // Read all prompt options currently rendered in DOM
        const promptOptions = document.querySelectorAll<HTMLElement>(
          '[data-automation-id="promptOption"], [role="option"], p[data-automation-label], .css-tv26v'
        );
        if (promptOptions.length > 0) {
          options = Array.from(promptOptions)
            .map((o) => (o.getAttribute('data-automation-label') || o.textContent || '').trim())
            .filter(Boolean);
        }

        // If listbox overlay is closed, provide categories matching Workday prompt options
        if (options.length === 0) {
          const lblLower = labelText.toLowerCase();
          if (lblLower.includes('ethnicity') || lblLower.includes('race')) {
            options = ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'I do not wish to disclose', 'Decline to specify'];
          } else if (lblLower.includes('gender')) {
            options = ['Male', 'Female', 'Non-Binary', 'Decline to Self-Identify', 'I do not wish to disclose'];
          } else if (lblLower.includes('veteran')) {
            options = ['I am not a protected veteran', 'I identify as one of the protected veteran categories', 'I do not wish to answer'];
          } else if (lblLower.includes('disability')) {
            options = ['Yes, I have a disability, or have a history/record of having a disability', 'No, I do not have a disability, or have a history/record of having a disability', 'I do not wish to answer'];
          } else if (lblLower.includes('how did you hear') || lblLower.includes('hear about us') || lblLower.includes('source')) {
            options = ['Job Board', 'Social Media', 'Website', 'Event/Conference', 'University', 'Associations'];
          }
        }
      }

      const currentValue = (el as HTMLInputElement).value || el.textContent || '';

      fields.push({
        id: fieldId,
        automationId: autoId,
        label: labelText,
        type: fieldType,
        placeholder: el.getAttribute('placeholder') || undefined,
        options: options.length > 0 ? Array.from(new Set(options)) : undefined,
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true' || labelText.endsWith('*'),
        currentValue: currentValue.slice(0, 100)
      });
    });

    return fields;
  }

  public static extractPageErrors(): { fieldLabel?: string; message: string; domContext?: string }[] {
    const errors: { fieldLabel?: string; message: string; domContext?: string }[] = [];

    // Scan for Workday Alert/Error boxes, inputAlert paragraphs, and error list items
    const alertElements = Array.from(document.querySelectorAll<HTMLElement>(
      'p[data-automation-id="inputAlert"], [data-automation-id*="error"], [id*="error"], [data-automation-id="errorHeading"] li, [data-automation-id="formField-errorMessage"], [role="alert"]'
    ));

    alertElements.forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (!text || text.length < 3 || text.toLowerCase().includes('indicates a required field')) return;

      // Find the associated field label from the parent formField container
      const container = el.closest('[data-automation-id*="formField"], fieldset, div.css-7t35fz, div.css-gvoll6') || el.parentElement;
      const labelEl = container?.querySelector('label, legend');
      const fieldLabel = labelEl?.textContent?.replace(/\*/g, '').trim() || undefined;

      // Extract DOM context: the surrounding container HTML (trimmed to ~2000 chars)
      let domContext: string | undefined;
      try {
        const contextEl = container || el.parentElement;
        if (contextEl) {
          const html = contextEl.outerHTML;
          domContext = html.length > 2000 ? html.substring(0, 2000) + '...' : html;
        }
      } catch {}

      errors.push({ fieldLabel, message: text, domContext });
    });

    return errors;
  }

  /**
   * Extract a comprehensive DOM snapshot of ALL error regions on the page.
   * This gives the AI agent full visibility into the DOM structure around errors.
   */
  public static extractErrorDOMContext(): string {
    const contextParts: string[] = [];

    // 1. Capture all error alert containers
    const alertContainers = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-automation-id*="formField"]:has(p[data-automation-id="inputAlert"]), fieldset:has([role="alert"]), [data-automation-id*="error"]'
    ));

    // Fallback: if :has() is not supported, manually find containers
    if (alertContainers.length === 0) {
      const alerts = Array.from(document.querySelectorAll<HTMLElement>(
        'p[data-automation-id="inputAlert"], [role="alert"]'
      ));
      alerts.forEach((alert) => {
        const container = alert.closest('[data-automation-id*="formField"], fieldset, div.css-7t35fz, div.css-gvoll6');
        if (container) {
          const html = container.outerHTML;
          contextParts.push(html.length > 2500 ? html.substring(0, 2500) + '...' : html);
        }
      });
    } else {
      alertContainers.forEach((c) => {
        const html = c.outerHTML;
        contextParts.push(html.length > 2500 ? html.substring(0, 2500) + '...' : html);
      });
    }

    // 2. Also capture the top-level error banner if present
    const errorBanner = document.querySelector<HTMLElement>('[data-automation-id="errorHeading"], [data-automation-id*="errorBanner"]');
    if (errorBanner) {
      const bannerHtml = errorBanner.outerHTML;
      contextParts.push(bannerHtml.length > 1500 ? bannerHtml.substring(0, 1500) + '...' : bannerHtml);
    }

    // 3. Capture blank work experience entries (no job title filled)
    const jobTitleInputs = Array.from(document.querySelectorAll<HTMLInputElement>(
      'input[data-automation-id*="jobTitle"]'
    ));
    jobTitleInputs.forEach((input) => {
      if (!input.value || input.value.trim() === '') {
        const expContainer = input.closest('[role="group"], fieldset, div[data-automation-id*="workExperience"]');
        if (expContainer) {
          // Just capture a summary — heading + delete button area
          const heading = expContainer.querySelector('h3, h4, h5, legend');
          const deleteBtn = expContainer.querySelector('button.css-zfgw5f, button[aria-label*="Delete"]');
          contextParts.push(`<blank-entry heading="${heading?.textContent?.trim() || 'Unknown'}" hasDeleteBtn="${!!deleteBtn}" />`);
        }
      }
    });

    // Limit total context to ~4000 chars to stay well within LLM token limits
    let combined = contextParts.map((p) => this.sanitizeHTMLForLLM(p)).join('\n\n---ERROR-REGION---\n\n');
    if (combined.length > 4000) {
      combined = combined.substring(0, 4000) + '\n... [truncated]';
    }

    return combined;
  }

  /**
   * Compress HTML snapshots by 80% for LLMs — removes SVGs, class names, styles, comments.
   */
  private static sanitizeHTMLForLLM(html: string): string {
    if (!html) return '';
    return html
      .replace(/<svg[\s\S]*?<\/svg>/gi, '') // Remove large SVG paths
      .replace(/\s*class="[^"]*"/gi, '')      // Remove verbose CSS class names
      .replace(/\s*style="[^"]*"/gi, '')      // Remove inline styles
      .replace(/\s+tabindex="[^"]*"/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')        // Remove HTML comments
      .replace(/\n\s*\n/g, '\n')              // Collapse empty lines
      .trim();
  }
}

