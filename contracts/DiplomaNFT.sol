// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract DiplomaNFT is ERC721URIStorage {
    uint256 private _nextTokenId;
    
    address public immutable kahootGame;

    error UnauthorizedGame(address caller);
    error InvalidAddress();

    modifier onlyGame() {
        if (msg.sender != kahootGame) revert UnauthorizedGame(msg.sender);
        _;
    }

    constructor(address _game) ERC721("Kahoot Web3 Diploma", "KWD") {
        if (_game == address(0)) revert InvalidAddress();
        kahootGame = _game;
    }

    function mintDiploma(address to, string memory tokenURI) external onlyGame {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
    }
}
