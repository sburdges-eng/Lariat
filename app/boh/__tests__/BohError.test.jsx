// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// The line book's error boundary.
//
// A cook mid-service must never get a blank screen out of reference paper.
// This checks they get a sentence they can act on, a retry, and a way back.

import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import BohError from '../error.jsx';
import I18nProvider from '../../_components/I18nProvider.jsx';

const boom = new Error('sheet blew up');

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe('BohError', () => {
  test('says what happened in words a cook can act on', () => {
    render(<BohError error={boom} reset={() => {}} />);

    expect(screen.getByRole('heading', { name: 'This sheet did not open.' })).toBeInTheDocument();
    expect(screen.getByText(/Use the paper packet for now/)).toBeInTheDocument();
  });

  test('offers a retry and a way back to the book', () => {
    const reset = jest.fn();
    render(<BohError error={boom} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('link', { name: 'Line book' })).toHaveAttribute('href', '/boh');
    expect(screen.getByRole('link', { name: /Back to the book/ })).toHaveAttribute('href', '/boh');
  });

  test('logs the real error for whoever picks it up later', () => {
    render(<BohError error={boom} reset={() => {}} />);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[boh]'), boom);
  });

  test('speaks Spanish when the cook does', () => {
    render(
      <I18nProvider locale="es">
        <BohError error={boom} reset={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Esta hoja no abrió.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeInTheDocument();
  });
});
