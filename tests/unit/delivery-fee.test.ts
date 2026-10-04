import {expect,it} from 'vitest';
import {orderTotals} from '@/features/billing/order-totals';
it('includes delivery in tax and the displayed total, while discounts apply to goods',()=>{expect(orderTotals([{quantity:2,unit_price:100}],10,15,20)).toEqual({subtotal:220,discount:10,tax:31.5,total:241.5,valid:true});expect(orderTotals([{quantity:1,unit_price:10}],15,15,20).valid).toBe(false);});
it('rejects negative, nonfinite and sub-cent delivery fees',()=>{for(const fee of [-1,NaN,Infinity,.001])expect(orderTotals([{quantity:1,unit_price:10}],0,15,fee).valid).toBe(false);});
