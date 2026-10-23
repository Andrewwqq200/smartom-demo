import { render, screen } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    })
  );
});

test("shows the intake workspace", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: /приёмка и цифровизация товаров/i })).toBeInTheDocument();
  expect(screen.getByText(/снимать автоматически/i)).toBeInTheDocument();
});
