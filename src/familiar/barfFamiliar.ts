import {
  cliExecute,
  equippedItem,
  Familiar,
  familiarWeight,
  Item,
  myFamiliar,
  numericModifier,
  print,
  Slot,
  useFamiliar,
  weightAdjustment,
} from "kolmafia";
import {
  $familiar,
  $item,
  $items,
  $location,
  $slots,
  findLeprechaunMultiplier,
  get,
  getModifier,
  maxBy,
  sum,
} from "libram";
import { NumericModifier } from "libram/dist/modifierTypes";
import { bonusGear } from "../outfit";
import { baseMeat, BonusEquipMode, HIGHLIGHT } from "../lib";
import { barfOutfit } from "../outfit/barf";
import { estimatedGarboTurns } from "../turns";
import { getAllDrops } from "./dropFamiliars";
import { getExperienceFamiliarLimit } from "./experienceFamiliars";
import { getAllJellyfishDrops, menu } from "./freeFightFamiliar";
import { GeneralFamiliar, timeToMeatify, turnsAvailable } from "./lib";
import { meatFamiliar } from "./meatFamiliar";
import { setMarginalFamiliarsExcessValue } from "../session";
import { garboValue } from "../garboValue";

const ITEM_DROP_VALUE = 0.72;
const MEAT_DROP_VALUE = baseMeat / 100;

type CachedOutfit = {
  weight: number;
  meat: number;
  item: number;
  bonus: number;
};

const outfitCache = new Map<number, CachedOutfit>();
const outfitSlots = $slots`hat, back, shirt, weapon, off-hand, pants, acc1, acc2, acc3, familiar`;

function getCachedOutfitValues(fam: Familiar) {
  const lepMult = findLeprechaunMultiplier(fam);
  const currentValue = outfitCache.get(lepMult);
  if (currentValue) return currentValue;

  const current = myFamiliar();
  cliExecute("checkpoint");
  try {
    barfOutfit(
      {
        familiar: fam,
        avoid: $items`Kramco Sausage-o-Matic™, cursed magnifying glass, protonic accelerator pack, "I Voted!" sticker, li'l pirate costume, bag of many confections`,
      },
      true,
    ).dress();

    const outfit = outfitSlots.map((slot) => equippedItem(slot));
    const bonuses = bonusGear(BonusEquipMode.EMBEZZLER, false);

    const values = {
      weight: sum(outfit, (eq: Item) => getModifier("Familiar Weight", eq)),
      meat: sum(outfit, (eq: Item) => getModifier("Meat Drop", eq)),
      item: sum(outfit, (eq: Item) => getModifier("Item Drop", eq)),
      bonus: sum(outfit, (eq: Item) => bonuses.get(eq) ?? 0),
    };
    outfitCache.set(lepMult, values);
    return values;
  } finally {
    useFamiliar(current);
    cliExecute("outfit checkpoint");
  }
}

type MarginalFamiliar = GeneralFamiliar & { outfitWeight: number; outfitValue: number };

const nonOutfitWeightBonus = () =>
  weightAdjustment() -
  sum(outfitSlots, (slot: Slot) => getModifier("Familiar Weight", equippedItem(slot)));

function familiarModifier(familiar: Familiar, modifier: NumericModifier): number {
  const cachedOutfitWeight = getCachedOutfitValues(familiar).weight;
  const totalWeight = familiarWeight(familiar) + nonOutfitWeightBonus() + cachedOutfitWeight;

  return numericModifier(familiar, modifier, totalWeight, $item.none);
}

function familiarAbilityValue(familiar: Familiar) {
  return (
    familiarModifier(familiar, "Meat Drop") * MEAT_DROP_VALUE +
    familiarModifier(familiar, "Item Drop") * ITEM_DROP_VALUE
  );
}

function totalFamiliarValue({ expectedValue, outfitValue, familiar }: MarginalFamiliar) {
  return expectedValue + outfitValue + familiarAbilityValue(familiar);
}

function turnsNeededForFamiliar(
  { familiar, limit, outfitValue }: MarginalFamiliar,
  baselineToCompareAgainst: MarginalFamiliar,
): number {
  switch (limit) {
    case "drops":
      return sum(
        getAllDrops(familiar).filter(
          ({ expectedValue }) =>
            outfitValue + familiarAbilityValue(familiar) + expectedValue >
            totalFamiliarValue(baselineToCompareAgainst),
        ),
        ({ expectedTurns }) => expectedTurns,
      );

    case "experience":
      return getExperienceFamiliarLimit(familiar);

    case "none":
      return 0;

    case "special":
      return getSpecialFamiliarLimit({ familiar, outfitValue, baselineToCompareAgainst });
  }
}

function calculateOutfitValue(f: GeneralFamiliar): MarginalFamiliar {
  const outfit = getCachedOutfitValues(f.familiar);
  const outfitValue = outfit.bonus + outfit.meat * MEAT_DROP_VALUE + outfit.item * ITEM_DROP_VALUE;
  const outfitWeight = outfit.weight;

  return { ...f, outfitValue, outfitWeight };
}
export function barfFamiliar(): Familiar {
  if (timeToMeatify()) return $familiar`Grey Goose`;
  if (get("garbo_IgnoreMarginalFamiliars", false)) return meatFamiliar();

  const fullMenu = menu({
    canChooseMacro: true,
    location: $location`Barf Mountain`,
    includeExperienceFamiliars: false,
  }).map(calculateOutfitValue);

  const meatFamiliarEntry = fullMenu.find(({ familiar }) => familiar === meatFamiliar());

  if (!meatFamiliarEntry) throw new Error("Something went wrong when initializing familiars!");

  const meatFamiliarValue = totalFamiliarValue(meatFamiliarEntry);
  const viableMenu = fullMenu.filter((f) => totalFamiliarValue(f) > meatFamiliarValue);

  if (viableMenu.every(({ limit }) => limit !== "none")) {
    const turnsNeeded = sum(viableMenu, (option: MarginalFamiliar) =>
      turnsNeededForFamiliar(option, meatFamiliarEntry),
    );

    if (turnsNeeded < turnsAvailable()) {
      const shrubAvailable = viableMenu.some(
        ({ familiar }) => familiar === $familiar`Crimbo Shrub`,
      );
      return shrubAvailable ? $familiar`Crimbo Shrub` : meatFamiliar();
    }
  }

  if (viableMenu.length === 0) {
    setMarginalFamiliarsExcessValue(0);
    return meatFamiliar();
  }

  const best = maxBy(viableMenu, totalFamiliarValue);

  // Because we run marginal familiars at the end, our marginal MPA is inflated by best.expectedValue - meatFamiliarValue every turn
  // Technically it's the nominalFamiliarValue, which for now is the max of meatFamiliar and jellyfish (if we have the jellyfish)
  const jellyfish = fullMenu.find(({ familiar }) => familiar === $familiar`Space Jellyfish`);
  const jellyfishValue = jellyfish
    ? garboValue($item`stench jelly`) / 20 +
      familiarAbilityValue(jellyfish.familiar) +
      jellyfish.outfitValue
    : 0;
  const excessValue = Math.max(
    best.expectedValue +
      best.outfitValue +
      familiarAbilityValue(best.familiar) -
      Math.max(meatFamiliarValue, jellyfishValue),
    0,
  );
  setMarginalFamiliarsExcessValue(excessValue);

  const familiarPrintout = (x: MarginalFamiliar) =>
    `(expected value of ${x.expectedValue.toFixed(1)} from familiar drops, ${familiarAbilityValue(
      x.familiar,
    ).toFixed(1)} from familiar abilities and ${x.outfitValue.toFixed(1)} from outfit)`;

  print(
    `Choosing to use ${best.familiar} ${familiarPrintout(best)} over ${
      meatFamiliarEntry.familiar
    } ${familiarPrintout(meatFamiliarEntry)}.`,
    HIGHLIGHT,
  );

  return best.familiar;
}

function getSpecialFamiliarLimit({
  familiar,
  outfitValue,
  baselineToCompareAgainst,
}: {
  familiar: Familiar;
  outfitValue: number;
  baselineToCompareAgainst: GeneralFamiliar & { outfitWeight: number; outfitValue: number };
}): number {
  switch (familiar) {
    case $familiar`Space Jellyfish`:
      return sum(
        getAllJellyfishDrops().filter(
          ({ expectedValue }) =>
            outfitValue + familiarAbilityValue(familiar) + expectedValue >
            totalFamiliarValue(baselineToCompareAgainst),
        ),
        ({ turnsAtValue }) => turnsAtValue,
      );

    case $familiar`Crimbo Shrub`:
      return Math.ceil(estimatedGarboTurns() / 100);

    default:
      return 0;
  }
}
