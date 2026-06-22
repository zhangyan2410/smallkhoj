import croodlesNeutralDefinition from "@dicebear/styles/croodles-neutral.json" with { type: "json" }

export const SMALLKHOJ_ENERGETIC_EYES_VARIANT = "smallkhojEnergetic01"
export const SMALLKHOJ_ENERGETIC_EYES_PATH =
  "M22 34c3.5-7 14.5-7 18 0m35 0c3.5-7 14.5-7 18 0M30 38c2.5 2 5.5 3 9 2.5m43-2.5c2.5 2 5.5 3 9 2.5"

type SvgElement = {
  name: string
  type: "element"
  attributes: Record<string, string | undefined>
}

type Variant = {
  elements: SvgElement[]
}

const smallkhojCroodlesNeutralDefinition = JSON.parse(JSON.stringify(croodlesNeutralDefinition)) as typeof croodlesNeutralDefinition

const eyeVariants = smallkhojCroodlesNeutralDefinition.components.eyes.variants as unknown as Record<string, Variant>
eyeVariants[SMALLKHOJ_ENERGETIC_EYES_VARIANT] = {
  elements: [
    {
      name: "path",
      type: "element",
      attributes: {
        d: SMALLKHOJ_ENERGETIC_EYES_PATH,
        stroke: "black",
        "stroke-width": "3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    },
  ],
}

export default smallkhojCroodlesNeutralDefinition
