import puppeteer from "puppeteer";
import { Client } from "memjs";
import { FACEBOOK_EMAIL, FACEBOOK_PASSWORD } from "./credentials";
import { exec } from "child_process";

const mem = Client.create(process.env.MEMCACHIER_SERVERS, {
    user: process.env.MEMCACHIER_USER,
    password: process.env.MEMCACHIER_PASSWORD
});

// A user agent that will get us a less secure version of the website
const userAgent = "Mozilla/5.0 (Linux; Android 6.0.1; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Mobile Safari/537.36";

// A default timeout for latent operations
const defaultTimeout = 1000;

// The main page we're using to log in
const mainPageURL = "https://m.facebook.com";

// Calls the given operation that kicks off a network request,
// then waits for the page to finish loading
const submitAndLoad = async (page: puppeteer.Page, submitOperation: Promise<void>) => {
    await Promise.all([
        submitOperation,
        page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);
};

// Updates the stored password on disk and returns it
const getNewPassword = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        // bump-password is a shell command I have configured to
        // update the password stored on disk and return the new one
        exec("bump-password", (err, stdout) => {
            if (err) {
                reject(err);
            }
            resolve(stdout);
        });
    });
};

interface BaseCookie {
    value: string;
    domain: string;
    path: string;
    expires: number;
    size: number;
    httpOnly: boolean;
    secure: boolean;
    session: boolean;
    sameParty: boolean;
    sourceScheme: string;
    sourcePort: number;
}

interface BrowserCookie extends BaseCookie {
    name?: string;
}

interface MemCookie extends BaseCookie {
    key?: string;
}

const memToBrowserCookies = (cookies: MemCookie[]): BrowserCookie[] => {
    return cookies.map((cookie: MemCookie): BrowserCookie => {
        const data = cookie.key;
        delete cookie["key"];

        const newCookie = cookie as BrowserCookie;
        newCookie.name = data;
        return newCookie;
    });
};

const browserToMemCookies = (cookies: BrowserCookie[]): MemCookie[] => {
    return cookies.map((cookie: BrowserCookie): MemCookie => {
        const data = cookie.name;
        delete cookie["name"];

        const newCookie = cookie as MemCookie;
        newCookie.key = data;
        return newCookie;
    });
};

const setCookies = async (page: puppeteer.Page, cookies: BrowserCookie[]) => {
    // @ts-ignore our cookie type and puppeteer's don't quite match up and
    // puppeteer doesn't export theirs
    page.setCookie(...cookies);
};

// Starts up the browser with the appropriate cookies and user agent and
// navigates to the login page (returns this page and the associated browser)
const setup = async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(mainPageURL);

    const data = await mem.get("appstate");
    const cookies: MemCookie[] = JSON.parse(data.value.toString());

    // Convert these back to valid cookies from their
    // facebook-chat-api representation
    const browserCookies = memToBrowserCookies(cookies);
    await setCookies(page, browserCookies);

    await page.setUserAgent(userAgent);

    return { browser, page };
};

// Logs in on the login page, resetting the password, approving any logins,
// and dismissing any notices as needed
const login = async (page: puppeteer.Page) => {
    // Enter existing username & password
    const emailField = "input[name=email]";
    await page.waitForSelector(emailField);
    await page.focus(emailField);
    await page.keyboard.type(FACEBOOK_EMAIL);

    const passwordField = "input[name=pass]";
    await page.waitForSelector(passwordField);
    await page.focus(passwordField);
    await page.keyboard.type(FACEBOOK_PASSWORD);

    await submitAndLoad(page, page.keyboard.press("Enter"));

    // If there's login approval required, approve it
    const approvalField = "button[name=\"submit[Yes]\"]";
    const approveButton = await page.$(approvalField);
    if (approveButton) {
        // The login approval doesn't issue a network request,
        // but it does have a bit of a render delay for some reason
        await approveButton.click();
    }

    // Reset the password if we need to
    const newPasswordField = "input[name=password_new]";
    try {
        // If we haven't gotten flagged by fb recently, we won't need to
        // fill in a new password
        await page.waitForSelector(newPasswordField, { timeout: defaultTimeout });
        await page.focus(newPasswordField);

        const newPassword = await getNewPassword();
        await page.keyboard.type(newPassword);

        await submitAndLoad(page, page.keyboard.press("Enter"));
    } catch {
        console.warn("no new password set");
    }

    // If there's an "easy log in" modal, dismiss it
    const okField = "button[value=OK]";
    try {
        await page.waitForSelector(okField, { timeout: defaultTimeout });
        await submitAndLoad(page, page.click(okField));
    } catch {
        // We don't care if this modal doesn't show up
    }
};

// Log in, resetting the password if necessary, and save
// the cookies so the bot can pick them up on the next restart
(async () => {
    const { browser, page } = await setup();
    await login(page);

    // Navigate back to the main page to subvert fb's rate-limiting
    // shenanigans even if you have a successful login
    await page.goto(mainPageURL);

    const newCookies = await page.cookies();
    const storedCookies = browserToMemCookies(newCookies);
    await mem.set("appstate", JSON.stringify(storedCookies), {});

    mem.close();
    await browser.close();
})();