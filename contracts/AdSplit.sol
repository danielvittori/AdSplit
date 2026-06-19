// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AdSplit — the chart for ads that haven't run yet
/// @notice A marketer opens a "battle" with 2-4 creative variants. Viewers stake a small amount of
///         native USDC (0.05-0.20 typical; capped at 1 per stake on-chain) on the variant that hooks
///         them most — a fast, real-money pre-launch
///         signal of which creative will convert. When the window closes, anyone (in practice an autonomous
///         Arc keeper agent) calls settle(): the variant with the most USDC staked wins, and the WHOLE pot
///         is credited to that variant's author — no platform, no fee, no skim. A tie for first or a battle
///         with zero stakes voids, and stakers pull a full refund. All payouts are pull-based, so a battle
///         can never be locked by a reverting recipient. Built for ARC: micro-stakes in native USDC, settled
///         in well under a second, paid out machine-to-person by software.
contract AdSplit {
    uint8 public constant OPEN = 1;
    uint8 public constant SETTLED = 2;
    uint8 public constant VOID = 3;

    uint256 public constant MIN_STAKE = 0.05 ether;   // native USDC, 18 decimals
    uint256 public constant MAX_STAKE = 1 ether;      // whale cap per stake
    uint8 public constant MIN_VARIANTS = 2;
    uint8 public constant MAX_VARIANTS = 4;
    uint64 public constant MIN_DURATION = 5 minutes;
    uint64 public constant MAX_DURATION = 7 days;
    uint256 public constant MAX_TITLE = 80;
    uint256 public constant MAX_LABEL = 48;
    uint256 public constant MAX_IMAGE = 256;

    struct Variant {
        address author;   // who gets paid if this variant wins (msg.sender in v1)
        string label;     // short name of the creative
        string image;     // image URL (hosted blob)
        uint256 staked;   // total USDC staked on this variant
        uint32 backers;   // distinct wallets that staked here
    }

    struct Battle {
        uint256 id;
        address creator;
        string title;
        uint64 deadline;
        uint64 createdAt;
        uint256 pot;          // total USDC across all variants
        uint8 variantCount;
        uint8 status;         // OPEN / SETTLED / VOID
        uint8 winner;         // valid only when SETTLED
    }

    uint256 public battleCount;
    uint256 public totalStaked;   // lifetime USDC staked
    uint256 public totalPaid;     // lifetime USDC paid to winning authors
    uint256 public settledCount;  // battles settled with a winner

    mapping(uint256 => Battle) public battles;
    mapping(uint256 => mapping(uint8 => Variant)) private _variants;
    mapping(uint256 => mapping(uint8 => mapping(address => uint256))) public myStake;
    mapping(uint256 => mapping(address => bool)) private _hasBacked;
    mapping(address => uint256[]) private _createdBy;
    mapping(address => uint256[]) private _backedBy;
    mapping(address => uint256) public owed; // pull-payment balance for winning authors

    event BattleCreated(uint256 indexed id, address indexed creator, string title, uint8 variantCount, uint64 deadline);
    event Staked(uint256 indexed id, uint8 indexed variant, address indexed backer, uint256 amount, uint256 newPot);
    event Settled(uint256 indexed id, uint8 winner, address indexed author, uint256 amount, address settledBy);
    event Voided(uint256 indexed id);
    event Withdrawn(address indexed who, uint256 amount);
    event Refunded(uint256 indexed id, uint8 variant, address indexed backer, uint256 amount);

    /// @notice Open a battle. In v1 every variant's author is the creator (the marketer testing their own set).
    function createBattle(string calldata title, string[] calldata labels, string[] calldata images, uint64 durationSecs)
        external
        returns (uint256)
    {
        uint256 n = labels.length;
        require(n >= MIN_VARIANTS && n <= MAX_VARIANTS, "2-4 variants");
        require(images.length == n, "labels/images mismatch");
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE, "bad title");
        require(durationSecs >= MIN_DURATION && durationSecs <= MAX_DURATION, "bad duration");

        uint256 id = ++battleCount;
        Battle storage b = battles[id];
        b.id = id;
        b.creator = msg.sender;
        b.title = title;
        b.createdAt = uint64(block.timestamp);
        b.deadline = uint64(block.timestamp) + durationSecs;
        b.variantCount = uint8(n);
        b.status = OPEN;

        for (uint8 i = 0; i < n; i++) {
            require(bytes(labels[i]).length > 0 && bytes(labels[i]).length <= MAX_LABEL, "bad label");
            require(bytes(images[i]).length > 0 && bytes(images[i]).length <= MAX_IMAGE, "bad image");
            Variant storage v = _variants[id][i];
            v.author = msg.sender;
            v.label = labels[i];
            v.image = images[i];
        }

        _createdBy[msg.sender].push(id);
        emit BattleCreated(id, msg.sender, title, uint8(n), b.deadline);
        return id;
    }

    /// @notice Stake native USDC on a variant (msg.value IS the stake — no approve, one tap).
    function stake(uint256 id, uint8 variant) external payable {
        Battle storage b = battles[id];
        require(b.status == OPEN, "not open");
        require(block.timestamp < b.deadline, "voting closed");
        require(variant < b.variantCount, "bad variant");
        require(msg.value >= MIN_STAKE && msg.value <= MAX_STAKE, "stake 0.05-1");

        Variant storage v = _variants[id][variant];
        if (myStake[id][variant][msg.sender] == 0) v.backers += 1;
        v.staked += msg.value;
        myStake[id][variant][msg.sender] += msg.value;
        b.pot += msg.value;
        totalStaked += msg.value;

        if (!_hasBacked[id][msg.sender]) {
            _hasBacked[id][msg.sender] = true;
            _backedBy[msg.sender].push(id);
        }
        emit Staked(id, variant, msg.sender, msg.value, b.pot);
    }

    /// @notice Settle a battle after its deadline — permissionless (an agent or anyone can call it).
    ///         Winner = the variant with the most USDC staked. Tie-for-first or zero pot voids.
    function settle(uint256 id) external {
        Battle storage b = battles[id];
        require(b.status == OPEN, "not open");
        require(block.timestamp >= b.deadline, "still open");

        if (b.pot == 0) {
            b.status = VOID;
            b.pot = 0;
            emit Voided(id);
            return;
        }

        uint8 best = 0;
        uint256 bestAmt = _variants[id][0].staked;
        bool tie = false;
        for (uint8 i = 1; i < b.variantCount; i++) {
            uint256 amt = _variants[id][i].staked;
            if (amt > bestAmt) {
                bestAmt = amt;
                best = i;
                tie = false;
            } else if (amt == bestAmt) {
                tie = true;
            }
        }

        if (tie) {
            // ambiguous winner — void and let everyone reclaim their stake
            b.status = VOID;
            emit Voided(id);
            return;
        }

        // effects (checks-effects-interactions; payout is pull-based)
        uint256 amount = b.pot;
        address author = _variants[id][best].author;
        b.pot = 0;
        b.status = SETTLED;
        b.winner = best;
        settledCount += 1;
        totalPaid += amount;
        owed[author] += amount;

        emit Settled(id, best, author, amount, msg.sender);
    }

    /// @notice Winning authors pull their accumulated winnings.
    function withdraw() external {
        uint256 amount = owed[msg.sender];
        require(amount > 0, "nothing owed");
        owed[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice On a VOID battle, each staker pulls back exactly what they staked, per variant.
    function refund(uint256 id, uint8 variant) external {
        require(battles[id].status == VOID, "not void");
        uint256 amount = myStake[id][variant][msg.sender];
        require(amount > 0, "nothing to refund");
        myStake[id][variant][msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "refund failed");
        emit Refunded(id, variant, msg.sender, amount);
    }

    /// @notice Creator can scrap a battle only while it holds no stakes (powerless over staked funds).
    function cancelBattle(uint256 id) external {
        Battle storage b = battles[id];
        require(b.creator == msg.sender, "not creator");
        require(b.status == OPEN, "not open");
        require(b.pot == 0, "has stakes");
        b.status = VOID;
        emit Voided(id);
    }

    // ── views ──────────────────────────────────────────────
    function getBattle(uint256 id) external view returns (Battle memory) {
        return battles[id];
    }

    function getVariant(uint256 id, uint8 variant) external view returns (Variant memory) {
        return _variants[id][variant];
    }

    /// @notice Live tallies for the split meter: each variant's staked amount, the current leader, and tie flag.
    function leaderState(uint256 id) external view returns (uint8 leadingIdx, bool tie, uint256[] memory staked) {
        Battle storage b = battles[id];
        staked = new uint256[](b.variantCount);
        if (b.variantCount == 0) return (0, false, staked);
        uint256 best = _variants[id][0].staked;
        staked[0] = best;
        for (uint8 i = 1; i < b.variantCount; i++) {
            uint256 amt = _variants[id][i].staked;
            staked[i] = amt;
            if (amt > best) { best = amt; leadingIdx = i; tie = false; }
            else if (amt == best) { tie = true; }
        }
        if (best == 0) tie = false;
    }

    function createdOf(address who) external view returns (uint256[] memory) {
        return _createdBy[who];
    }

    function backedOf(address who) external view returns (uint256[] memory) {
        return _backedBy[who];
    }
}
