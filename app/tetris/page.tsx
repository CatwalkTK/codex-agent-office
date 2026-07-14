import type { Metadata } from "next";
import { TetrisGame } from "../TetrisGame";

export const metadata: Metadata = {
  title: "NEON TETRIS",
  description: "積んで、回して、消していくネオンアーケードスタイルのテトリスゲーム。",
};

export default function TetrisPage() {
  return <TetrisGame />;
}
