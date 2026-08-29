import { WorkdayDetector } from './workdayDetector';
import { WorkdayParser } from './workdayParser';
import { DOMFiller } from './domFiller';
import { WorkdayMutationObserver } from './mutationObserver';

console.log('[Workday AI Auto-Filler] Content script initialized.');

const mutationObserver = new WorkdayMutationObserver();

// Auto-fill login credentials if present on Workday Sign In / Register pages
function autoFillAuthCredentials() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
      chrome.storage.local.get(['authUser'], (result) => {
        if (chrome.runtime?.lastError) return;
        if (result?.authUser?.email && result?.authUser?.password) {
          const emailField = document.querySelector<HTMLInputElement>(
            'input[data-automation-id="email"], input[type="email"], input[name="username"], input[data-automation-id="userName"]'
          );
          const passField = document.querySelector<HTMLInputElement>(
            'input[data-automation-id="password"], input[type="password"], input[name="password"]'
          );

          if (emailField && !emailField.value) {
            DOMFiller.setInputValue(emailField, result.authUser.email);
          }
          if (passField && !passField.value) {
            DOMFiller.setInputValue(passField, result.authUser.password);
          }
        }
      });
    }
  } catch {
    // Ignore context invalidation
  }
}

// Check on load and on mutation
autoFillAuthCredentials();
mutationObserver.start(() => {
  autoFillAuthCredentials();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STEP_STATUS': {
      const status = WorkdayDetector.getStepStatus();
      sendResponse({ success: true, status });
      break;
    }

    case 'EXTRACT_FIELDS': {
      const fields = WorkdayParser.extractFormFields();
      const pageErrors = WorkdayParser.extractPageErrors();
      const status = WorkdayDetector.getStepStatus();
      sendResponse({ success: true, fields, pageErrors, status });
      break;
    }

    case 'EXECUTE_AUTOFILL': {
      const { instructions, candidate } = message.payload;
      DOMFiller.executeInstructions(instructions, candidate).then((result) => {
        sendResponse({ success: true, result });
      });
      return true; // Keep channel open for async response
    }

    case 'SOLVE_DOM_ERRORS': {
      const { candidate } = message.payload;
      DOMFiller.autoSolveDOMErrors(candidate).then((solvedCount) => {
        sendResponse({ success: true, solvedCount });
      });
      return true;
    }

    case 'EXTRACT_ERROR_CONTEXT': {
      const errors = WorkdayParser.extractPageErrors();
      const domContext = WorkdayParser.extractErrorDOMContext();
      const status = WorkdayDetector.getStepStatus();
      sendResponse({ success: true, errors, domContext, status });
      break;
    }

    case 'APPLY_AI_FIXES': {
      const { fixes, candidate: fixCandidate } = message.payload;
      DOMFiller.applyAIFixes(fixes, fixCandidate).then((appliedCount) => {
        sendResponse({ success: true, appliedCount });
      });
      return true;
    }

    case 'SUBMIT_STEP': {
      // First, auto-dismiss any Workday date validation quirks by tapping calendar icon
      try {
        DOMFiller.solveAllDateErrors();
      } catch {}

      // Find Next or Save and Continue button
      let nextBtn = document.querySelector<HTMLElement>(
        '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="next"], [data-automation-id*="pageFooterNextButton"], [data-automation-id*="click-save-and-continue"], button[aria-label*="Save and Continue"], button[aria-label*="Save & Continue"], button[aria-label*="Continue"], button[aria-label*="Next"]'
      );

      if (!nextBtn) {
        // Fallback text search for Workday bottom action buttons
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"], a, input[type="submit"], input[type="button"]')
        );
        nextBtn = candidates.find((b) => {
          const text = (b.textContent || b.getAttribute('value') || '').toLowerCase().trim();
          return text.includes('save and continue') || text.includes('save & continue') || text === 'continue' || text === 'next';
        }) || null;
      }

      if (nextBtn) {
        try {
          nextBtn.focus();
          nextBtn.click();

          // Dispatch mouse events to ensure Workday React triggers navigation
          nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

          // Check if top error banner pops up and auto-solve that exact error
          setTimeout(async () => {
            try {
              if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['profile'], async (res) => {
                  if (res?.profile) {
                    await DOMFiller.autoSolveDOMErrors(res.profile);
                  }
                });
              }
            } catch {}
          }, 1200);

          sendResponse({ success: true, message: 'Triggered Save & Continue step navigation' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Save & Continue button not found on page' });
      }
      break;
    }

    case 'FINAL_SUBMIT': {
      let submitBtn = document.querySelector<HTMLElement>(
        '[data-automation-id="bottom-navigation-next-button"], button[aria-label*="Submit"], [data-automation-id*="submit"]'
      );

      if (!submitBtn) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
        submitBtn = candidates.find((b) => {
          const text = (b.textContent || '').toLowerCase().trim();
          return text.includes('submit application') || text === 'submit';
        }) || null;
      }

      if (submitBtn) {
        try {
          submitBtn.focus();
          submitBtn.click();
          submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          sendResponse({ success: true, message: 'Application submitted successfully!' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Submit click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Submit button not found on page.' });
      }
      break;
    }

    case 'TRIGGER_AUTOFILL_WITH_RESUME': {
      let btn = document.querySelector<HTMLElement>(
        'a[data-automation-id="autofillWithResume"], button[data-automation-id="autofillWithResume"], [data-automation-id*="autofillWithResume"], [data-automation-id*="autofill-with-resume"], a[href*="autofillWithResume"], a[href*="autofill-with-resume"]'
      );

      if (!btn) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], div[role="button"]'));
        btn = candidates.find((el) => {
          const txt = (el.textContent || '').toLowerCase().trim();
          return txt.includes('autofill with resume') || txt.includes('autofill');
        }) || null;
      }

      if (btn) {
        try {
          DOMFiller.clickWorkdayOptionElement(btn);
          if (btn instanceof HTMLAnchorElement && btn.href && !btn.href.startsWith('javascript:')) {
            btn.click();
          }
          sendResponse({ success: true, message: 'Clicked Autofill with Resume' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Autofill with Resume button not found on page.' });
      }
      break;
    }

    case 'TRIGGER_SIGN_IN_WITH_EMAIL': {
      let btn = document.querySelector<HTMLElement>(
        'button[data-automation-id="SignInWithEmailButton"], [data-automation-id*="SignInWithEmail"], button[data-automation-id*="signInWithEmail"]'
      );

      if (!btn) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
        btn = candidates.find((el) => {
          const txt = (el.textContent || '').toLowerCase().trim();
          return txt.includes('sign in with email') || txt.includes('sign in');
        }) || null;
      }

      if (btn) {
        try {
          DOMFiller.clickWorkdayOptionElement(btn);
          sendResponse({ success: true, message: 'Clicked Sign in with email' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Sign in with email button not found on page.' });
      }
      break;
    }

    case 'TRIGGER_CREATE_ACCOUNT': {
      let btn = document.querySelector<HTMLElement>(
        'button[data-automation-id*="createAccount"], a[data-automation-id*="createAccount"], button[data-automation-id*="register"]'
      );

      if (!btn) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
        btn = candidates.find((el) => {
          const txt = (el.textContent || '').toLowerCase().trim();
          return txt.includes('create account') || txt.includes('sign up') || txt.includes('register');
        }) || null;
      }

      if (btn) {
        try {
          DOMFiller.clickWorkdayOptionElement(btn);
          sendResponse({ success: true, message: 'Clicked Create Account' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Create Account button not found on page.' });
      }
      break;
    }

    case 'AUTOFILL_CREATE_ACCOUNT_CREDENTIALS': {
      const { email, password } = message.payload || {};
      DOMFiller.fillWorkdayCreateAccount(email, password).then((count) => {
        const agreementCb = document.querySelector<HTMLInputElement>(
          'input[type="checkbox"][data-automation-id="createAccountCheckbox"], input[type="checkbox"][data-automation-id*="createAccount"], input[type="checkbox"][data-automation-id*="agreement"], input[type="checkbox"][data-automation-id*="terms"], input[type="checkbox"][id*="agreement"], input[type="checkbox"][id*="terms"]'
        );
        if (agreementCb && !agreementCb.checked) {
          DOMFiller.setCheckboxValue(agreementCb, true);
        }
        sendResponse({ success: true, count });
      });
      return true;
    }

    case 'SUBMIT_CREATE_ACCOUNT': {
      let btn = document.querySelector<HTMLElement>(
        'div[data-automation-id="click_filter"][aria-label*="Create Account"], button[data-automation-id="createAccountSubmitButton"], button[data-automation-id*="createAccountSubmit"], [data-automation-id*="createAccount"] button, [data-automation-id*="createAccount"] [role="button"]'
      );

      if (!btn) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'));
        btn = candidates.find((el) => {
          const txt = (el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || '').toLowerCase().trim();
          return txt.includes('create account');
        }) || null;
      }

      if (btn) {
        try {
          DOMFiller.clickWorkdayOptionElement(btn);

          // Workday button wrapper: if we clicked the div or button, also trigger adjacent/nested button or container form submit
          const parentWrapper = btn.closest('.css-1s1r74k, form, div');
          if (parentWrapper) {
            const innerBtn = parentWrapper.querySelector<HTMLElement>('button[type="submit"], button[data-automation-id="createAccountSubmitButton"], [data-automation-id="click_filter"]');
            if (innerBtn && innerBtn !== btn) {
              DOMFiller.clickWorkdayOptionElement(innerBtn);
            }
          }
          const form = btn.closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }

          sendResponse({ success: true, message: 'Submitted Create Account' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Create Account submit button not found.' });
      }
      break;
    }

    case 'SUBMIT_SIGN_IN': {
      let btn = document.querySelector<HTMLElement>(
        'div[data-automation-id="click_filter"][aria-label*="Sign In"], div[data-automation-id="click_filter"][aria-label*="Submit"], button[data-automation-id="signInSubmitButton"], button[data-automation-id*="signInSubmit"], [data-automation-id*="signIn"] button, [data-automation-id*="signIn"] [role="button"]'
      );

      if (!btn) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'));
        btn = candidates.find((el) => {
          const txt = (el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || '').toLowerCase().trim();
          return txt.includes('sign in') || txt === 'submit';
        }) || null;
      }

      if (btn) {
        try {
          DOMFiller.clickWorkdayOptionElement(btn);

          // Workday button wrapper: if we clicked the div or button, also trigger adjacent/nested button or container form submit
          const parentWrapper = btn.closest('.css-1s1r74k, form, div');
          if (parentWrapper) {
            const innerBtn = parentWrapper.querySelector<HTMLElement>('button[type="submit"], button[data-automation-id="signInSubmitButton"], [data-automation-id="click_filter"]');
            if (innerBtn && innerBtn !== btn) {
              DOMFiller.clickWorkdayOptionElement(innerBtn);
            }
          }
          const form = btn.closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }

          sendResponse({ success: true, message: 'Submitted Sign In' });
        } catch (err: any) {
          sendResponse({ success: false, message: `Click error: ${err.message}` });
        }
      } else {
        sendResponse({ success: false, message: 'Sign In submit button not found.' });
      }
      break;
    }

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});