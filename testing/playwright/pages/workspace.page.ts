import {type Page,expect} from "@playwright/test";
export class WorkspacePage{
 constructor(readonly page:Page){}
 async open(){await this.page.goto("/");await expect(this.page.getByText("Virtual Inbox")).toBeVisible()}
 async openEmailCreation(){await this.page.getByRole("button",{name:"+"}).first().click()}
 async findMessage(subject:string){return this.page.getByRole("button").filter({hasText:subject}).first()}
 async selectAddress(address:string){await this.page.getByText(address,{exact:true}).first().click()}
}
