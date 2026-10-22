/** Clipboard boundary. No UI, logging or persistent storage of copied values. */
export async function copyText(value:string):Promise<void>{
 if(!navigator.clipboard?.writeText)throw new Error("Clipboard API unavailable");
 await navigator.clipboard.writeText(value);
}
