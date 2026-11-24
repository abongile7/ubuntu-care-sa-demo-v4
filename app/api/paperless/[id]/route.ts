import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit, CareError, errorResponse } from "@/lib/care-access";
import { getDocument, documentDigest, digest } from "@/lib/paperless";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireAuthSession();const {id}=await params;
    const doc=await getDocument(user,id);
    if(documentDigest(doc,doc.attachment?.digest)!==doc.digest||doc.signatures.some(s=>s.documentDigest!==doc.digest))throw new CareError(409,"Document integrity check failed.");
    const headers={"Cache-Control":"private, no-store",Vary:"Cookie","X-Content-Type-Options":"nosniff","Content-Type":"application/pdf","Content-Disposition":'attachment; filename="ubuntu-document.pdf"'};
    if(new URL(request.url).searchParams.get("attachment")==="1"){
      const file=await prisma.paperAttachment.findUnique({where:{documentId:id}});
      if(!file)throw new CareError(404,"Attachment not found.");
      if(digest(file.bytes)!==file.digest)throw new CareError(409,"Attachment integrity check failed.");
      await audit(prisma,user,null,"DOCUMENT_ATTACHMENT_DOWNLOADED",id);
      return new NextResponse(new Uint8Array(file.bytes),{headers});
    }
    const pdf=await PDFDocument.create(), font=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    let page=pdf.addPage([595,842]),y=785;
    function line(value:string,heading=false){
      // Standard PDF font cannot encode arbitrary Unicode. Escape rather than silently drop characters.
      const safe=Array.from(value).map(c=>{try{font.encodeText(c);return c;}catch{return "[U+"+c.codePointAt(0)!.toString(16).toUpperCase()+"]";}}).join("");
      for(const paragraph of safe.split(/\r?\n/)){
        let current="";
        for(const ch of paragraph){if(font.widthOfTextAtSize(current+ch,11)>510){draw(current);current="";}current+=ch;}
        draw(current);
      }
      function draw(s:string){if(y<55){page=pdf.addPage([595,842]);y=785;}page.drawText(s||" ",{x:42,y,size:11,font:heading?bold:font,color:rgb(.08,.19,.27)});y-=17;}
    }
    line("UBUNTUCARE SA | SYNTHETIC DEMONSTRATION",true);line(doc.title,true);line("Patient: "+doc.patient.fullName+" | File: "+doc.patient.facilityFileNumber);line("Document ID: "+id);line("Category: "+doc.category+" | Status: "+doc.status);line("Issued: "+doc.createdAt.toISOString()+" by "+doc.createdByName);line("");line(doc.body);line("");line("Electronic signature evidence (demo; not accredited)",true);line("SHA-256 content digest: "+doc.digest);
    for(const s of doc.signatures)line(s.signerName+" ("+s.signerRole+") | "+s.createdAt.toISOString());
    if(!doc.signatures.length)line("No signatures recorded.");
    if(doc.attachment)line("Attachment: "+doc.attachment.fileName+" | SHA-256: "+doc.attachment.digest);
    await audit(prisma,user,null,"DOCUMENT_PDF_DOWNLOADED",id);
    return new NextResponse(new Uint8Array(await pdf.save()),{headers});
  }catch(e){return errorResponse(e);}
}
