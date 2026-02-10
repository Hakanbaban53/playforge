import { Injectable, Signal } from "@angular/core";
import { Overlay, OverlayConfig, OverlayRef } from "@angular/cdk/overlay";
import { ComponentPortal } from "@angular/cdk/portal";
import { InvoiceEditorComponent } from "../components/invoice-editor/invoice-editor";
import { Product } from "../models/product.model";

@Injectable({
  providedIn: "root",
})
export class InvoiceOverlayService {
  private overlayRef?: OverlayRef;

  constructor(private overlay: Overlay) {}

  open(invoiceItems: Signal<Product[]>) {
    if (this.overlayRef) {
      return;
    }

    const positionStrategy = this.overlay
      .position()
      .global()
      .centerHorizontally()
      .centerVertically();

    const config = new OverlayConfig({
      hasBackdrop: true,
      scrollStrategy: this.overlay.scrollStrategies.block(),
      positionStrategy,
    });

    this.overlayRef = this.overlay.create(config);

    const portal = new ComponentPortal(InvoiceEditorComponent);
    const componentRef = this.overlayRef.attach(portal);

    // Pass input data
    componentRef.instance.invoiceItems.set(invoiceItems());

    // Listen to close event if the component emits one
    if (componentRef.instance.close) {
      componentRef.instance.close.subscribe(() => this.close());
    }

    this.overlayRef.backdropClick().subscribe(() => this.close());
  }

  close() {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = undefined;
    }
  }
}
