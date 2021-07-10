// A base definition for a cookie that both the browser and API
// representations share
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

// In the browser, this field is called "name"
interface BrowserCookie extends BaseCookie {
    name?: string;
}

// For the API, this field is called "key"
interface APICookie extends BaseCookie {
    key?: string;
}