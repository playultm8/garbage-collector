import { Item } from "kolmafia";
import { globalOptions } from "./config";
import { makeValue, ValueFunctions } from "./libgarbo";
import { $item } from "libram";

let _valueFunctions: ValueFunctions | undefined = undefined;
function garboValueFunctions(): ValueFunctions {
  if (!_valueFunctions) {
    _valueFunctions = makeValue({
      quick: globalOptions.quick,
      itemValues: new Map([[$item`fake hand`, 50000]]),
    });
  }
  return _valueFunctions;
}

export function garboValue(item: Item, useHistorical = false): number {
  return garboValueFunctions().value(item, useHistorical);
}

export function garboAverageValue(...items: Item[]): number {
  return garboValueFunctions().averageValue(...items);
}
