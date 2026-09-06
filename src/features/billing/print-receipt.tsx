"use client";
import {Button} from "@/components/ui/button";
export function PrintReceipt(){return <Button className="print:hidden" onClick={()=>window.print()}>Print / save PDF</Button>;}
