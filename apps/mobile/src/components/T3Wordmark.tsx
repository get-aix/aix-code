import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 94.5 / 57;
  return (
    <Svg
      accessibilityLabel="aix"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="15.53 37 94.5 57"
    >
      <ThemedPath
        d="M15.53 73A19 21 0 0 1 53.53 73A19 21 0 0 1 15.53 73ZM27.03 73A7.5 10.5 0 0 0 42.03 73A7.5 10.5 0 0 0 27.03 73ZM41.53 52H53.53V94H41.53ZM58.78 52H70.78V94H58.78ZM58.78 43A6 6 0 0 1 70.78 43A6 6 0 0 1 58.78 43ZM76.03 52H89.53L110.03 94H96.53ZM96.53 52H110.03L89.53 94H76.03Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
