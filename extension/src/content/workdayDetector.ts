import { StepStatus } from '../types';

export class WorkdayDetector {
  public static isWorkdaySite(): boolean {
    const hostname = window.location.hostname;
    const isWorkdayDomain = hostname.includes('myworkdayjobs.com') || hostname.includes('workday.com');
    const hasWorkdayElements = !!(
      document.querySelector('[data-automation-id]') ||
      document.querySelector('div[id*="workday"]') ||
      document.querySelector('form[data-automation-id]')
    );
    return isWorkdayDomain || hasWorkdayElements;
  }

  public static getStepStatus(): StepStatus {
    const isWorkday = this.isWorkdaySite();

    let stepName = 'Application Form';

    // 1. Try to detect current step from Workday progress bar (most accurate)
    const progressStepEl = document.querySelector(
      '[data-automation-id="currentStep"], ' +
      '[data-automation-id*="step"][aria-current="step"], ' +
      '[data-automation-id*="step"][aria-current="true"], ' +
      '.css-1gn33c3, ' +  // Workday active step class
      'div[data-automation-id*="applyFlow"] li[aria-current], ' +
      'div[data-automation-id*="progressBar"] [aria-current]'
    );
    if (progressStepEl && progressStepEl.textContent) {
      const txt = progressStepEl.textContent.trim();
      if (txt && txt.length < 60) {
        stepName = txt;
      }
    }

    // 2. If still default, try the page heading h2/h3 that matches known step names
    if (stepName === 'Application Form') {
      const allHeadings = Array.from(document.querySelectorAll('h2, h3'));
      const knownSteps = ['my information', 'my experience', 'application questions',
        'voluntary disclosures', 'self identify', 'review', 'education', 'work experience'];
      for (const heading of allHeadings) {
        const hText = (heading.textContent || '').trim();
        if (hText && knownSteps.some(s => hText.toLowerCase().includes(s))) {
          stepName = hText;
          break;
        }
      }
    }

    // 3. Fallback: any data-automation-id step/pageHeader element
    if (stepName === 'Application Form') {
      const fallbackEl = document.querySelector('[data-automation-id*="step"], [data-automation-id*="pageHeader"]');
      if (fallbackEl && fallbackEl.textContent) {
        const txt = fallbackEl.textContent.trim();
        if (txt && txt.length < 80) {
          stepName = txt;
        }
      }
    }

    // 4. Check for Start Your Application screen
    if (stepName === 'Application Form') {
      const startEl = document.querySelector('a[data-automation-id="autofillWithResume"], [data-automation-id="useMyLastApplication"], a[data-automation-id="applyManually"]');
      if (startEl || document.body.innerText.includes('Start Your Application')) {
        stepName = 'Start Your Application';
      }
    }

    // 5. Check for Sign In Options vs Sign In Form vs Create Account screens
    if (stepName === 'Application Form' || stepName.toLowerCase().includes('create account/sign in')) {
      if (document.querySelector('button[data-automation-id="SignInWithEmailButton"], [data-automation-id*="SignInWithEmail"]')) {
        stepName = 'Sign In Options';
      } else if (document.querySelector('button[data-automation-id="createAccountSubmitButton"], input[data-automation-id="verifyPassword"]')) {
        stepName = 'Create Account';
      } else if (document.querySelector('button[data-automation-id="signInSubmitButton"], [data-automation-id="signInFormo"], [data-automation-id="formField-email"] input[autocomplete="email"]')) {
        stepName = 'Sign In Form';
      } else {
        const authTitle = document.querySelector('#authViewTitle, h3#authViewTitle');
        const authTitleText = (authTitle?.textContent || '').trim().toLowerCase();
        if (authTitleText.includes('create account')) {
          stepName = 'Create Account';
        } else if (authTitleText.includes('sign in')) {
          stepName = 'Sign In Form';
        }
      }
    }

    const inputs = document.querySelectorAll('input, select, textarea, [data-automation-id*="formField"]');

    // Check for final review step / submit button
    const submitBtn = document.querySelector('[data-automation-id="bottom-navigation-next-button"], button[aria-label*="Submit"]');
    const isFinalReviewStep = !!(
      submitBtn &&
      (submitBtn.textContent?.toLowerCase().includes('submit') ||
       document.body.innerText.toLowerCase().includes('review your application before submitting'))
    );

    // Check if Create Account fields are filled
    let isCreateAccountFilled = false;
    if (stepName === 'Create Account') {
      const emailVal = (document.querySelector<HTMLInputElement>('input[data-automation-id="email"], input[type="email"]')?.value || '').trim();
      const passVal = (document.querySelector<HTMLInputElement>('input[data-automation-id="password"], input[type="password"]')?.value || '').trim();
      const verifyVal = (document.querySelector<HTMLInputElement>('input[data-automation-id="verifyPassword"]')?.value || '').trim();
      if (emailVal.length > 0 && passVal.length > 0 && verifyVal.length > 0) {
        isCreateAccountFilled = true;
      }
    }

    // Check if Sign In fields are filled
    let isSignInFilled = false;
    if (stepName === 'Sign In Form') {
      const emailVal = (document.querySelector<HTMLInputElement>('input[data-automation-id="email"], input[type="email"], input[name="username"], input[data-automation-id="userName"]')?.value || '').trim();
      const passVal = (document.querySelector<HTMLInputElement>('input[data-automation-id="password"], input[type="password"], input[name="password"]')?.value || '').trim();
      if (emailVal.length > 0 && passVal.length > 0) {
        isSignInFilled = true;
      }
    }

    return {
      stepName,
      isWorkdayPage: isWorkday,
      totalFieldsCount: inputs.length,
      filledFieldsCount: 0,
      isFinalReviewStep,
      isCreateAccountFilled,
      isSignInFilled
    };
  }
}
